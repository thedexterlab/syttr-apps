import React from "react";
import MapViewNative, { Marker as MarkerNative, PROVIDER_GOOGLE } from "react-native-maps";
import type { ViewProps } from "react-native";

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
  onPress?: () => void;
  children?: React.ReactNode;
};

export const MapView: React.FC<MapViewProps> = ({ children, webQuery: _webQuery, ...rest }) => {
  return <MapViewNative {...rest}>{children}</MapViewNative>;
};

export const Marker: React.FC<MarkerProps> = ({ children, ...rest }) => {
  return <MarkerNative {...rest}>{children}</MarkerNative>;
};

export { PROVIDER_GOOGLE };
