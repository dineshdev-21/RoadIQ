import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';

// leaflet.heat is a classic plugin that patches a global L; it is imported after this module.
(window as unknown as { L: typeof L }).L = L;

declare module 'leaflet' {
  interface HeatLayer extends L.Layer {
    setLatLngs(points: [number, number, number][]): this;
  }
  function heatLayer(
    points: [number, number, number][],
    options?: { radius?: number; blur?: number; maxZoom?: number; gradient?: Record<number, string> },
  ): HeatLayer;
}

export default L;
