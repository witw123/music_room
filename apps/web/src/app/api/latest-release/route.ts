import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "MusicRoom-App"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch("https://api.github.com/repos/witw123/music_room/releases/latest", {
      headers,
      next: { revalidate: 600 }
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    // Fallback if GitHub API rate limit is exceeded or API fails:
    // Query github.com/witw123/music_room/releases/latest which 302-redirects to the tag URL without API rate limits.
    const redirectRes = await fetch("https://github.com/witw123/music_room/releases/latest", {
      method: "HEAD",
      redirect: "manual"
    });

    const location = redirectRes.headers.get("location");
    if (location) {
      const match = location.match(/\/tag\/([^/?#]+)/);
      if (match) {
        const tagName = decodeURIComponent(match[1]);
        const version = tagName.replace(/^[vV]/, "");
        const releaseUrl = location.startsWith("http") ? location : `https://github.com${location}`;

        return NextResponse.json({
          tag_name: tagName,
          name: tagName,
          published_at: new Date().toISOString(),
          html_url: releaseUrl,
          body: "通过 GitHub Releases 发布最新版本。",
          assets: [
            {
              name: `Music.Room_${version}_x64-setup.exe`,
              browser_download_url: `https://github.com/witw123/music_room/releases/download/${tagName}/Music.Room_${version}_x64-setup.exe`,
              size: 0
            },
            {
              name: `Music.Room_${version}_universal.dmg`,
              browser_download_url: `https://github.com/witw123/music_room/releases/download/${tagName}/Music.Room_${version}_universal.dmg`,
              size: 0
            },
            {
              name: `Music.Room_${version}_amd64.AppImage`,
              browser_download_url: `https://github.com/witw123/music_room/releases/download/${tagName}/Music.Room_${version}_amd64.AppImage`,
              size: 0
            },
            {
              name: `MusicRoom-Android-${tagName}.apk`,
              browser_download_url: `https://github.com/witw123/music_room/releases/download/${tagName}/MusicRoom-Android-${tagName}.apk`,
              size: 0
            }
          ]
        });
      }
    }

    return NextResponse.json(
      { error: `GitHub API error: ${response.status} ${response.statusText}` },
      { status: response.status }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch release info" },
      { status: 500 }
    );
  }
}
