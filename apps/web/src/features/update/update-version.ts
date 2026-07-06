const releaseVersionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/i;

type ParsedReleaseVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseReleaseVersion(value: string): ParsedReleaseVersion | null {
  const match = value.trim().match(releaseVersionPattern);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function normalizeReleaseVersion(value: string) {
  const parsed = parseReleaseVersion(value);
  if (!parsed) {
    return null;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function compareReleaseVersions(left: string, right: string) {
  const parsedLeft = parseReleaseVersion(left);
  const parsedRight = parseReleaseVersion(right);
  if (!parsedLeft || !parsedRight) {
    return 0;
  }

  const leftSegments = [parsedLeft.major, parsedLeft.minor, parsedLeft.patch];
  const rightSegments = [parsedRight.major, parsedRight.minor, parsedRight.patch];

  for (let index = 0; index < leftSegments.length; index += 1) {
    const delta = leftSegments[index] - rightSegments[index];
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function isNewerReleaseVersion(currentVersion: string, candidateVersion: string) {
  return compareReleaseVersions(candidateVersion, currentVersion) > 0;
}
