declare module "react-native-reanimated" {
  const Animated: any;
  export default Animated;
  export const interpolate: (...args: any[]) => any;
  export const useAnimatedRef: <T = any>() => any;
  export const useAnimatedStyle: (updater: () => any) => any;
  export const useScrollOffset: (ref: any) => { value: number };
}
