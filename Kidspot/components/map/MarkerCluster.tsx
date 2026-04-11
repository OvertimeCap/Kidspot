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

export default function MarkerCluster({ cluster, supercluster, mapRef }: Props) {
  const [longitude, latitude] = cluster.geometry.coordinates;
  const { point_count: count, cluster_id: clusterId } = cluster.properties;

  function handlePress() {
    const expansionZoom = Math.min(
      supercluster.getClusterExpansionZoom(clusterId),
      17,
    );
    const delta = 360 / Math.pow(2, expansionZoom) / 2;
    mapRef.current?.animateToRegion(
      {
        latitude,
        longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      400,
    );
  }

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      // tracksViewChanges={false} é CRÍTICO para performance em Android
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
    // Borda branca sutil para destacar sobre o mapa
    borderWidth: 2,
    borderColor: "#fff",
    // Sombra leve
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
