/**
 * Pure-math sunrise/sunset calculator using the NOAA algorithm.
 * No external API calls required.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function toJulianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function calcGeomMeanLongSun(t: number): number {
  let L0 = 280.46646 + t * (36000.76983 + t * 0.0003032);
  while (L0 > 360) L0 -= 360;
  while (L0 < 0) L0 += 360;
  return L0;
}

function calcGeomMeanAnomalySun(t: number): number {
  return 357.52911 + t * (35999.05029 - 0.0001537 * t);
}

function calcEccentricityEarthOrbit(t: number): number {
  return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
}

function calcSunEqOfCenter(t: number): number {
  const m = calcGeomMeanAnomalySun(t) * DEG_TO_RAD;
  return (
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  );
}

function calcSunTrueLong(t: number): number {
  return calcGeomMeanLongSun(t) + calcSunEqOfCenter(t);
}

function calcSunApparentLong(t: number): number {
  const omega = (125.04 - 1934.136 * t) * DEG_TO_RAD;
  return calcSunTrueLong(t) - 0.00569 - 0.00478 * Math.sin(omega);
}

function calcMeanObliquityOfEcliptic(t: number): number {
  return 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
}

function calcObliquityCorrection(t: number): number {
  const omega = (125.04 - 1934.136 * t) * DEG_TO_RAD;
  return calcMeanObliquityOfEcliptic(t) + 0.00256 * Math.cos(omega);
}

function calcSunDeclination(t: number): number {
  const e = calcObliquityCorrection(t) * DEG_TO_RAD;
  const lambda = calcSunApparentLong(t) * DEG_TO_RAD;
  return Math.asin(Math.sin(e) * Math.sin(lambda)) * RAD_TO_DEG;
}

function calcEquationOfTime(t: number): number {
  const eps = calcObliquityCorrection(t) * DEG_TO_RAD;
  const l0 = calcGeomMeanLongSun(t) * DEG_TO_RAD;
  const e = calcEccentricityEarthOrbit(t);
  const m = calcGeomMeanAnomalySun(t) * DEG_TO_RAD;
  let y = Math.tan(eps / 2);
  y *= y;
  return (
    4 *
    RAD_TO_DEG *
    (y * Math.sin(2 * l0) -
      2 * e * Math.sin(m) +
      4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * e * e * Math.sin(2 * m))
  );
}

function calcHourAngle(lat: number, solarDec: number, rise: boolean): number {
  const latRad = lat * DEG_TO_RAD;
  const sdRad = solarDec * DEG_TO_RAD;
  const HA = Math.acos(
    Math.cos(90.833 * DEG_TO_RAD) / (Math.cos(latRad) * Math.cos(sdRad)) -
      Math.tan(latRad) * Math.tan(sdRad)
  );
  return rise ? -HA * RAD_TO_DEG : HA * RAD_TO_DEG;
}

function calcSunriseSetUTC(rise: boolean, JD: number, lat: number, lng: number): number {
  const t = (JD - 2451545) / 36525;
  const eqTime = calcEquationOfTime(t);
  const solarDec = calcSunDeclination(t);
  const hourAngle = calcHourAngle(lat, solarDec, rise);
  const delta = -lng + hourAngle;
  return 720 - 4 * delta - eqTime; // minutes from midnight UTC
}

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  /** True if the sun never sets (polar day) */
  polarDay?: boolean;
  /** True if the sun never rises (polar night) */
  polarNight?: boolean;
}

/**
 * Returns sunrise and sunset times for the given date and location.
 * Falls back to 6:00 / 18:00 if the calculation is not finite (polar regions).
 */
export function getSunTimes(date: Date, latitude: number, longitude: number): SunTimes {
  const JD = toJulianDay(date);

  const sunriseMinutes = calcSunriseSetUTC(true, JD, latitude, longitude);
  const sunsetMinutes = calcSunriseSetUTC(false, JD, latitude, longitude);

  const offsetMinutes = date.getTimezoneOffset(); // negative east of UTC

  if (!isFinite(sunriseMinutes) || !isFinite(sunsetMinutes)) {
    // Polar day or night – return sensible fallbacks
    const noon = new Date(date);
    noon.setHours(12, 0, 0, 0);
    const altSunrise = new Date(date);
    altSunrise.setHours(6, 0, 0, 0);
    const altSunset = new Date(date);
    altSunset.setHours(18, 0, 0, 0);
    return {
      sunrise: altSunrise,
      sunset: altSunset,
      polarDay: !isFinite(sunriseMinutes) && !isFinite(sunsetMinutes),
    };
  }

  const riseLocal = sunriseMinutes - offsetMinutes;
  const setLocal = sunsetMinutes - offsetMinutes;

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const sunrise = new Date(startOfDay.getTime() + riseLocal * 60 * 1000);
  const sunset = new Date(startOfDay.getTime() + setLocal * 60 * 1000);

  return { sunrise, sunset };
}
