/** A single weather snapshot collected by a scheduled job. */
export interface Observation {
  jobId: string;
  location: string;
  observedAt: string; // ISO timestamp
  temperature: number; // °C
  humidity: number; // %
  windSpeed: number; // km/h
  description: string;
}

export interface WeatherSummary {
  count: number;
  from: string | null;
  to: string | null;
  temperature: { min: number; max: number; avg: number } | null;
  humidity: { avg: number } | null;
  windSpeed: { avg: number } | null;
  descriptions: Record<string, number>;
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Aggregate a set of weather observations into a compact summary: time range,
 * temperature min/max/avg, average humidity and wind, and how often each
 * weather description appeared. Pure and side-effect free.
 */
export function aggregateObservations(observations: Observation[]): WeatherSummary {
  if (observations.length === 0) {
    return {
      count: 0,
      from: null,
      to: null,
      temperature: null,
      humidity: null,
      windSpeed: null,
      descriptions: {},
    };
  }

  const times = observations.map(o => o.observedAt).sort();
  const temps = observations.map(o => o.temperature);
  const humidities = observations.map(o => o.humidity);
  const winds = observations.map(o => o.windSpeed);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const descriptions: Record<string, number> = {};
  for (const o of observations) {
    const key = o.description || 'Unknown';
    descriptions[key] = (descriptions[key] ?? 0) + 1;
  }

  return {
    count: observations.length,
    from: times[0],
    to: times[times.length - 1],
    temperature: {
      min: Math.min(...temps),
      max: Math.max(...temps),
      avg: round(sum(temps) / temps.length),
    },
    humidity: { avg: round(sum(humidities) / humidities.length) },
    windSpeed: { avg: round(sum(winds) / winds.length) },
    descriptions,
  };
}
