export const loadOptionalModule = <T>(_name: string, loader: () => T): T | null => {
  try {
    return loader();
  } catch {
    return null;
  }
};



export default function RouteShim() {
  return null as any;
}

