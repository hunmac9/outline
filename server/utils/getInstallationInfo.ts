import { version } from "../../package.json";
import fetch from "./fetch";

const dockerhubLink =
  "https://hub.docker.com/v2/repositories/outlinewiki/outline";

function isFullReleaseVersion(versionName: string): boolean {
  const releaseRegex = /^(version-)?\d+\.\d+\.\d+$/; // Matches "N.N.N" or "version-N.N.N" for dockerhub releases before v0.56.0"
  return releaseRegex.test(versionName);
}

export async function getVersionInfo(currentVersion: string): Promise<{
  latestVersion: string;
  versionsBehind: number;
}> {
  // Return default values immediately, bypassing the Docker Hub check
  // as it's not relevant for a fork.
  return {
    latestVersion: currentVersion,
    versionsBehind: -1, // Indicate check was bypassed or version not found upstream
  };
}

export function getVersion(): string {
  return version;
}
