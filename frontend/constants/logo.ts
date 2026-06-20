type LogoSizeOptions = {
  scale?: number;
  min?: number;
  max?: number;
  innerRatio?: number;
};

const DEFAULT_LOGO_SIZE: Required<LogoSizeOptions> = {
  scale: 0.45,
  min: 100,
  max: 180,
  innerRatio: 0.82,
};

export const getLogoDimensions = (
  width: number,
  options: LogoSizeOptions = {}
) => {
  const settings = { ...DEFAULT_LOGO_SIZE, ...options };
  const outerSize = Math.min(Math.max(width * settings.scale, settings.min), settings.max);
  const innerSize = outerSize * settings.innerRatio;

  return {
    outerSize,
    innerSize,
    outerRadius: outerSize / 2,
    innerRadius: innerSize / 2,
  };
};

