import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

type Coordinate = {
  latitude: number;
  longitude: number;
};

type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type MapViewProps = ViewProps & {
  region?: MapRegion;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  provider?: any;
  webQuery?: string;
  children?: React.ReactNode;
};

type MarkerProps = {
  coordinate: Coordinate;
  title?: string;
  description?: string;
  children?: React.ReactNode;
};

const DEFAULT_PROVIDER = "google";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const buildWebMapSrc = (region?: MapRegion, webQuery?: string) => {
  const latitude = Number(region?.latitude ?? 39.809734);
  const longitude = Number(region?.longitude ?? -98.55562);
  const latitudeDelta = Math.max(Number(region?.latitudeDelta ?? 0.08), 0.01);
  const longitudeDelta = Math.max(Number(region?.longitudeDelta ?? 0.08), 0.01);

  const south = clamp(latitude - latitudeDelta / 2, -85, 85);
  const north = clamp(latitude + latitudeDelta / 2, -85, 85);
  const west = clamp(longitude - longitudeDelta / 2, -180, 180);
  const east = clamp(longitude + longitudeDelta / 2, -180, 180);
  const marker = `${latitude}%2C${longitude}`;
  const bbox = `${west}%2C${south}%2C${east}%2C${north}`;
  const query = String(webQuery || "").trim();

  if (query) {
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}&query=${encodeURIComponent(query)}`;
  }

  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
};

export const MapView: React.FC<MapViewProps> = ({ children, style, region, webQuery }) => {
  const src = buildWebMapSrc(region, webQuery);
  const Iframe: any = "iframe";

  return (
    <View style={[styles.fallback, style]}>
      <Iframe
        title="Syttr map"
        src={src}
        style={styles.webFrame as any}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      {children}
    </View>
  );
};

export const Marker: React.FC<MarkerProps> = () => null;

export const PROVIDER_GOOGLE = DEFAULT_PROVIDER;

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "#E8F3FF",
  },
  webFrame: {
    width: "100%",
    height: "100%",
    borderWidth: 0,
    borderColor: "transparent",
  } as any,
});
