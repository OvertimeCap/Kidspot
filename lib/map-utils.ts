// Inline type — mesma forma do Region do react-native-maps, sem importar o módulo nativo
type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Raio de busca em metros a partir da região visível do mapa.
 * Usa haversine entre o centro e o canto superior-direito do retângulo (+10% de margem).
 * Limitado a 9.800m (servidor aceita max 10.000m).
 */
export function radiusFromRegion(region: Region): number {
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  const cornerLat = latitude + latitudeDelta / 2;
  const cornerLng = longitude + longitudeDelta / 2;
  const R = 6_371_000;
  const dLat = ((cornerLat - latitude) * Math.PI) / 180;
  const dLng = ((cornerLng - longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((latitude * Math.PI) / 180) *
      Math.cos((cornerLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.min(
    Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.1),
    9_800,
  );
}

/**
 * Nível de zoom inteiro para use-supercluster derivado de longitudeDelta.
 * Clampado a [0, 20] para evitar Infinity/NaN durante animações de zoom rápido.
 */
export function zoomFromRegion(region: Region): number {
  const delta = region.longitudeDelta;
  // Guard: delta inválido durante animação de zoom (0 ou negativo → Infinity/NaN)
  if (!delta || delta <= 0) return 10;
  const zoom = Math.log(360 / delta) / Math.LN2;
  // Clamp para faixa válida do supercluster (0 a 20)
  return Math.max(0, Math.min(20, Math.round(zoom)));
}

/**
 * Bounding box para use-supercluster.
 * ATENÇÃO: a ordem é [westLng, southLat, eastLng, northLat] — longitude ANTES da latitude.
 * Garante largura/altura mínima de 0.0002° (~22m) para evitar bounds colapsados em animações.
 */
export function boundsFromRegion(
  region: Region,
): [number, number, number, number] {
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  // Mínimo de 0.0002° evita bounds colapsados durante animação de zoom
  const halfLat = Math.max(Math.abs(latitudeDelta) / 2, 0.0002);
  const halfLng = Math.max(Math.abs(longitudeDelta) / 2, 0.0002);
  return [
    longitude - halfLng, // westLng
    latitude - halfLat,  // southLat
    longitude + halfLng, // eastLng
    latitude + halfLat,  // northLat
  ];
}

export function boundsObjectFromRegion(region: Region): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const [west, south, east, north] = boundsFromRegion(region);
  return { north, south, east, west };
}
