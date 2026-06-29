import { describe, it, expect } from 'vitest';
import { aggregateObservations, type Observation } from '../../src/mcp/weather-aggregate';

function obs(partial: Partial<Observation>): Observation {
  return {
    jobId: 'job_1',
    location: 'London',
    observedAt: '2026-01-01T00:00:00.000Z',
    temperature: 10,
    humidity: 50,
    windSpeed: 5,
    description: 'Sunny',
    ...partial,
  };
}

describe('aggregateObservations', () => {
  it('returns an empty summary for no observations', () => {
    const summary = aggregateObservations([]);
    expect(summary).toEqual({
      count: 0,
      from: null,
      to: null,
      temperature: null,
      humidity: null,
      windSpeed: null,
      descriptions: {},
    });
  });

  it('aggregates count, time range, temperature, humidity and wind', () => {
    const summary = aggregateObservations([
      obs({ observedAt: '2026-01-01T10:00:00.000Z', temperature: 8, humidity: 60, windSpeed: 4 }),
      obs({ observedAt: '2026-01-01T11:00:00.000Z', temperature: 12, humidity: 40, windSpeed: 6 }),
      obs({ observedAt: '2026-01-01T12:00:00.000Z', temperature: 16, humidity: 50, windSpeed: 8 }),
    ]);

    expect(summary.count).toBe(3);
    expect(summary.from).toBe('2026-01-01T10:00:00.000Z');
    expect(summary.to).toBe('2026-01-01T12:00:00.000Z');
    expect(summary.temperature).toEqual({ min: 8, max: 16, avg: 12 });
    expect(summary.humidity).toEqual({ avg: 50 });
    expect(summary.windSpeed).toEqual({ avg: 6 });
  });

  it('determines the time range regardless of input order', () => {
    const summary = aggregateObservations([
      obs({ observedAt: '2026-01-01T12:00:00.000Z' }),
      obs({ observedAt: '2026-01-01T08:00:00.000Z' }),
      obs({ observedAt: '2026-01-01T10:00:00.000Z' }),
    ]);
    expect(summary.from).toBe('2026-01-01T08:00:00.000Z');
    expect(summary.to).toBe('2026-01-01T12:00:00.000Z');
  });

  it('counts description frequencies and labels blanks as Unknown', () => {
    const summary = aggregateObservations([
      obs({ description: 'Sunny' }),
      obs({ description: 'Sunny' }),
      obs({ description: 'Cloudy' }),
      obs({ description: '' }),
    ]);
    expect(summary.descriptions).toEqual({ Sunny: 2, Cloudy: 1, Unknown: 1 });
  });

  it('rounds averages to one decimal place', () => {
    const summary = aggregateObservations([
      obs({ temperature: 10, humidity: 33, windSpeed: 1 }),
      obs({ temperature: 11, humidity: 34, windSpeed: 2 }),
    ]);
    expect(summary.temperature?.avg).toBe(10.5);
    expect(summary.humidity?.avg).toBe(33.5);
    expect(summary.windSpeed?.avg).toBe(1.5);
  });
});
