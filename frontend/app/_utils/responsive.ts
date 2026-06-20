import { Dimensions, PixelRatio } from "react-native";

const BASE_WIDTH = 400;

const size = () => Dimensions.get("window");
const scale = (value: number) => (size().width / BASE_WIDTH) * value;

export const wp = (percent: number) => (size().width * percent) / 100;
export const hp = (percent: number) => (size().height * percent) / 100;

export const rf = (fontSize: number) => {
  const scaled = scale(fontSize);
  return Math.round(PixelRatio.roundToNearestPixel(scaled));
};

export const rs = (value: number) => {
  const scaled = scale(value);
  return Math.round(PixelRatio.roundToNearestPixel(scaled));
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const contentMaxWidth = () => clamp(size().width * 0.96, 320, 560);



export default function RouteShim() {
  return null as any;
}

