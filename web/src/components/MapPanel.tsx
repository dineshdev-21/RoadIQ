import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Crosshair, Flame } from 'lucide-preact';
import L from '../lib/leaflet';
import 'leaflet.heat';
import 'leaflet.markercluster';
import type { Alert } from '../lib/types';

export const CORRIDOR_CENTER: [number, number] = [31.2505, 75.7112];
const CORRIDOR_ZOOM = 13;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_CREDIT = '&copy; <a href="https://www.esri.com/">Esri</a>';

type Basemap = 'light' | 'osm' | 'satellite';

function makeBasemap(kind: Basemap): L.Layer {
  if (kind === 'osm') {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
  }
  const base = kind === 'satellite' ? 'World_Imagery' : 'Canvas/World_Light_Gray_Base';
  const ref = kind === 'satellite' ? 'Canvas/World_Dark_Gray_Reference' : 'Canvas/World_Light_Gray_Reference';
  return L.layerGroup([
    L.tileLayer(`${ESRI}/${base}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution: `${ESRI_CREDIT}, OpenStreetMap contributors` }),
    L.tileLayer(`${ESRI}/${ref}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16 }),
  ]);
}

const SHAPES: Record<string, string> = { Pothole: 'disc', 'Manhole Cover': 'diamond' };

/** Everything the pin's look depends on; a marker is only rebuilt when this changes. */
const pinKey = (a: Alert, open: boolean) =>
  `${a.severity_score}|${a.anomaly_class}|${a.confirmation_count >= 3}|${open}|${a.latitude},${a.longitude}`;

function pinIcon(a: Alert, open: boolean) {
  const shape = SHAPES[a.anomaly_class] ?? 'square';
  const sev = Math.min(5, Math.max(1, Math.round(Number(a.severity_score)) || 1));
  const cls = `pin pin--${shape} sev-${sev}${a.confirmation_count >= 3 ? ' pin--confirmed' : ''}${open ? ' is-open' : ''}`;
  return L.divIcon({
    html: `<span class="${cls}"><span>${sev}</span></span>`,
    className: 'pin-host',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function tooltipFor(a: Alert) {
  const el = document.createElement('span');
  el.textContent = `${a.anomaly_class}, severity ${a.severity_score}: ${a.road_name}`;
  return el;
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface Props {
  alerts: Alert[];
  selectedId: string | null;
  focus: { lat: number; lon: number; n: number } | null;
  onSelect: (id: string) => void;
  children?: ComponentChildren;
}

export function MapPanel({ alerts, selectedId, focus, onSelect, children }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.MarkerClusterGroup | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; key: string }>());
  const heat = useRef<L.HeatLayer | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [basemap, setBasemap] = useState<Basemap>('light');
  const [heatOn, setHeatOn] = useState(false);

  useEffect(() => {
    const m = L.map(el.current!, { center: CORRIDOR_CENTER, zoom: CORRIDOR_ZOOM, zoomControl: true, maxZoom: 18 });
    // Clusters keep stacked pins apart at corridor zoom; each shows its count, coloured by its worst severity.
    layer.current = L.markerClusterGroup({
      disableClusteringAtZoom: 16,
      maxClusterRadius: 36,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => {
        const worst = Math.max(...cluster.getAllChildMarkers().map((mk) => (mk.options as { sev?: number }).sev ?? 1));
        return L.divIcon({
          html: `<span class="pin pin--cluster sev-${worst}"><span>${cluster.getChildCount()}</span></span>`,
          className: 'pin-host',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
      },
    }).addTo(m);
    map.current = m;
    // Leaflet measures its box once; re-measure whenever the layout around it changes
    const resize = new ResizeObserver(() => m.invalidateSize({ pan: false }));
    resize.observe(el.current!);
    return () => {
      resize.disconnect();
      m.remove();
      markers.current.clear();
      heat.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current!;
    const tiles = makeBasemap(basemap).addTo(m);
    return () => void m.removeLayer(tiles);
  }, [basemap]);

  // Keyed diff: add new pins, drop gone ones, re-icon only pins whose look changed.
  useEffect(() => {
    const seen = new Set<string>();
    for (const a of alerts) {
      seen.add(a.event_id);
      const open = a.event_id === selectedId;
      const key = pinKey(a, open);
      const z = open ? 1000 : a.severity_score * 10;
      const known = markers.current.get(a.event_id);
      if (!known) {
        const marker = L.marker([a.latitude, a.longitude], { icon: pinIcon(a, open), keyboard: true, title: a.road_name, zIndexOffset: z, sev: a.severity_score } as L.MarkerOptions)
          .bindTooltip(tooltipFor(a), { direction: 'top', offset: [0, -14] })
          .on('click', () => onSelectRef.current(a.event_id));
        layer.current!.addLayer(marker);
        markers.current.set(a.event_id, { marker, key });
      } else if (known.key !== key) {
        (known.marker.options as { sev?: number }).sev = a.severity_score;
        known.marker.setIcon(pinIcon(a, open)).setLatLng([a.latitude, a.longitude]).setZIndexOffset(z);
        layer.current!.refreshClusters(known.marker);
        known.marker.setTooltipContent(tooltipFor(a));
        known.key = key;
      }
    }
    for (const [id, { marker }] of markers.current) {
      if (!seen.has(id)) {
        layer.current!.removeLayer(marker);
        markers.current.delete(id);
      }
    }
  }, [alerts, selectedId]);

  // The heat layer exists only while it is shown.
  useEffect(() => {
    const m = map.current!;
    if (!heatOn) {
      if (heat.current) m.removeLayer(heat.current);
      heat.current = null;
      return;
    }
    const points = alerts.map((a): [number, number, number] => [a.latitude, a.longitude, a.severity_score / 5]);
    if (heat.current) heat.current.setLatLngs(points);
    else {
      heat.current = L.heatLayer(points, {
        radius: 28,
        blur: 18,
        maxZoom: 16,
        gradient: { 0.2: cssVar('--sev-2'), 0.5: cssVar('--sev-3'), 0.8: cssVar('--sev-4'), 1: cssVar('--sev-5') },
      }).addTo(m);
    }
  }, [alerts, heatOn]);

  // Frame every pin once, when the first data arrives; after that the view is the user's.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || alerts.length === 0 || !map.current) return;
    framed.current = true;
    map.current.fitBounds(L.latLngBounds(alerts.map((a) => [a.latitude, a.longitude] as [number, number])), { padding: [48, 48], maxZoom: 15 });
  }, [alerts]);

  // Zoom to a report; when the inspector covers the right of the map, centre the pin in what stays visible.
  useEffect(() => {
    const m = map.current;
    if (!focus || !m) return;
    const z = 16;
    const card = el.current?.parentElement?.querySelector<HTMLElement>('.inspector');
    const covered = card && getComputedStyle(card).position === 'absolute' ? card.offsetWidth / 2 : 0;
    const centre = m.unproject(m.project([focus.lat, focus.lon], z).add([covered, 0]), z);
    m.setView(centre, z, { animate: true });
  }, [focus]);

  // Opening a report from the queue brings its pin out of any cluster and into view.
  useEffect(() => {
    const known = selectedId ? markers.current.get(selectedId) : undefined;
    if (known) layer.current!.zoomToShowLayer(known.marker, () => undefined);
  }, [selectedId]);

  return (
    <section class="map-panel" aria-label="Corridor map">
      <div class="map-tools">
        <label class="tool-select">
          <span class="visually-hidden">Map style</span>
          <select id="selectBasemap" value={basemap} onChange={(e) => setBasemap(e.currentTarget.value as Basemap)}>
            <option value="light">Light canvas</option>
            <option value="osm">Street map</option>
            <option value="satellite">Satellite</option>
          </select>
        </label>
        <button type="button" id="btnToggleHeatmap" class="btn btn--tool" aria-pressed={heatOn} onClick={() => setHeatOn((v) => !v)}>
          <Flame size={16} aria-hidden="true" />
          Density
        </button>
        <button type="button" id="btnRecenterMap" class="btn btn--tool" onClick={() => map.current?.setView(CORRIDOR_CENTER, CORRIDOR_ZOOM, { animate: true })}>
          <Crosshair size={16} aria-hidden="true" />
          Corridor
        </button>
      </div>
      <div class="map-stage">
      <div id="roadMap" ref={el} class="map-canvas" role="region" aria-label="Map of reported road defects" />
      <dl class="legend" aria-label="Map key">
        <div><dt><span class="key-swatch sev-5" aria-hidden="true" /></dt><dd>5 Critical</dd></div>
        <div><dt><span class="key-swatch sev-4" aria-hidden="true" /></dt><dd>4 High</dd></div>
        <div><dt><span class="key-swatch sev-3" aria-hidden="true" /></dt><dd>3 Medium</dd></div>
        <div><dt><span class="key-swatch sev-2" aria-hidden="true" /></dt><dd>1 and 2 Minor</dd></div>
        <div><dt><span class="key-shape key-shape--disc" aria-hidden="true" /></dt><dd>Pothole</dd></div>
        <div><dt><span class="key-shape key-shape--diamond" aria-hidden="true" /></dt><dd>Manhole cover</dd></div>
        <div><dt><span class="key-shape key-shape--square" aria-hidden="true" /></dt><dd>Bump or rough patch</dd></div>
        <div><dt><span class="key-shape key-shape--disc key-shape--confirmed" aria-hidden="true" /></dt><dd>3 or more vehicles</dd></div>
      </dl>
      {children}
      </div>
    </section>
  );
}
