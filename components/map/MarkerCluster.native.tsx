import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Marker } from "react-native-maps";
import type MapView from "react-native-maps";
import type Supercluster from "supercluster";
import Colors from "@/constants/colors";

interface ClusterProperties {
  cluster: true;
  cluster_id: number;
  point_count: number;
  point_count_abbreviated: string | number;
}

interface Props {
  cluster: Supercluster.ClusterFeature<ClusterProperties>;
  supercluster: Supercluster;
  mapRef: React.RefObject<MapView | null>;
}

function getRegionForCoordinates(
  coordinates: { latitude: number; longitude: number }[],
) {
  if (coordinates.length === 0) return null;

  if (coordinates.length === 1) {
    return {
      latitude: coordinates[0].latitude,
      longitude: coordinates[0].longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.3, 0.02),
  };
}

export default function MarkerCluster({ cluster, supercluster, mapRef }: Props) {
  const [longitude, latitude] = cluster.geometry.coordinates;
  const { point_count: count, cluster_id: clusterId } = cluster.properties;

  function handlePress() {
    if (!mapRef.current) return;

    try {
      const leaves = supercluster.getLeaves(clusterId, count);
      const coordinates = leaves
        .map((leaf) => ({
          latitude: leaf.geometry.coordinates[1],
          longitude: leaf.geometry.coordinates[0],
        }))
        .filter((coordinate) =>
          Number.isFinite(coordinate.latitude) &&
          Number.isFinite(coordinate.longitude),
        );

      const targetRegion = getRegionForCoordinates(coordinates);
      if (!targetRegion) return;
      mapRef.current.animateToRegion(targetRegion, 350);
    } catch {
      mapRef.current.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        },
        350,
      );
    }
  }

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      tracksViewChanges={false}
      onPress={handlePress}
    >
      <View style={styles.cluster}>
        <Text style={styles.count}>{count}</Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  cluster: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  count: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
