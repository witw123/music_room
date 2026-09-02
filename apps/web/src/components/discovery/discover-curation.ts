import type { Track, DiscoverPlaylistCard } from "./discover-types";
import { providerTrackKey } from "./discover-types";
import type { ProfileProviderRecommendations } from "@/features/discovery/profile-provider-recommendations";

export type DiscoverArtistItem = {
  artistName: string;
  representativeTrack: Track;
  artworkUrl: string | null;
  trackCount: number;
  reason: string;
};

export function extractDiscoverArtists(data: ProfileProviderRecommendations): DiscoverArtistItem[] {
  const map = new Map<string, DiscoverArtistItem>();
  const candidates = [...data.familiarArtists, ...data.forYou];
  for (const item of candidates) {
    const artist = item.candidate.artist?.trim();
    if (!artist) continue;
    if (!map.has(artist)) {
      map.set(artist, {
        artistName: artist,
        representativeTrack: item.candidate,
        artworkUrl: item.candidate.artworkUrl ?? null,
        trackCount: 1,
        reason: item.reasons[0] ?? "常听歌手"
      });
    } else {
      map.get(artist)!.trackCount += 1;
    }
  }
  return Array.from(map.values()).slice(0, 8);
}

export function getTimeContext() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) {
    return {
      greeting: "清晨时光",
      badge: "晨光清醒",
      subtitle: "用元气旋律唤醒灵感，开启清爽充沛的一天。"
    };
  }
  if (hour >= 11 && hour < 14) {
    return {
      greeting: "正午小憩",
      badge: "午后放松",
      subtitle: "轻快旋律伴你舒缓身心，享受片刻惬意闲适。"
    };
  }
  if (hour >= 14 && hour < 18) {
    return {
      greeting: "午后专注",
      badge: "工作专注",
      subtitle: "沉浸式器乐与流动节拍，提升思考与专注效率。"
    };
  }
  if (hour >= 18 && hour < 22) {
    return {
      greeting: "傍晚微醺",
      badge: "晚间放松",
      subtitle: "卸下一天的疲惫，在律动与温润声线中归于平静。"
    };
  }
  return {
    greeting: "深夜私享",
    badge: "夜听疗愈",
    subtitle: "漫漫长夜，用温柔纯净的声响陪伴静谧思绪。"
  };
}

export const genreCategoryPresets = [
  { id: "rock", title: "摇滚与能量专栏", description: "充满张力与力量感的摇滚、朋克与独立之声。", tags: ["摇滚", "独立", "能量", "朋克"], keywords: ["摇滚", "rock", "朋克", "金属", "metal", "punk", "硬核"] },
  { id: "electronic", title: "电子律动空间", description: "跳跃节奏与合成器声场，沉浸式电音精选。", tags: ["电子", "EDM", "电音", "律动"], keywords: ["电子", "edm", "house", "techno", "电音", "synth", "dance", "舞曲"] },
  { id: "focus", title: "专注与纯音小憩", description: "清透静谧的器乐与氛围音乐，伴你沉浸思考。", tags: ["专注", "纯音", "学习", "轻音乐"], keywords: ["专注", "学习", "工作", "轻音乐", "纯音乐", "lo-fi", "chill", "白噪音", "钢琴", "古典"] },
  { id: "night", title: "夜听与疗愈私享", description: "深夜温暖陪伴，抚平情绪的治愈与慢调旋律。", tags: ["夜听", "深夜", "治愈", "R&B"], keywords: ["夜听", "深夜", "夜晚", "晚安", "治愈", "r&b", "soul", "放空", "疗愈"] },
  { id: "acg", title: "ACG 与二次元幻想", description: "动漫游戏原声与日系旋律，开启异次元共鸣。", tags: ["ACG", "动漫", "二次元", "J-pop"], keywords: ["acg", "anime", "二次元", "动漫", "动画", "游戏", "vocaloid", "日系", "j-pop", "日语"] },
  { id: "guofeng", title: "新国风与古韵雅集", description: "丝竹戏腔与现代编曲交织的华夏音韵。", tags: ["国风", "古风", "仙侠", "华语", "戏腔", "新中式", "武侠"] },
  { id: "rnb", title: "R&B 与都市律动", description: "丝滑转音与慵懒节奏，都市夜色中的随性律动。", tags: ["R&B", "都市", "律动", "Soul"], keywords: ["r&b", "rnb", "soul", "嘻哈", "说唱", "hip-hop", "rap", "都市"] },
  { id: "folk", title: "民谣与温暖叙事", description: "一把木吉他与质朴故事，诉说人间烟火与诗意。", tags: ["民谣", "木吉他", "温暖", "故事"], keywords: ["民谣", "folk", "吉他", "不插电", "民乐"] }
];

export function buildCuratedPlaylistCards(data: ProfileProviderRecommendations): DiscoverPlaylistCard[] {
  const getArtistsExcerpt = (tracks: Track[]) => {
    const artists = Array.from(new Set(tracks.map((t) => t.artist).filter(Boolean))).slice(0, 3);
    return artists.length ? `包含 ${artists.join(" · ")} 等` : "为您量身定制的专属精选";
  };

  const familiarTracks = data.familiarArtists.map((i) => i.candidate);
  const deepTracks = data.deepCuts.map((i) => i.candidate);
  const moodTracks = data.moodDiscovery.map((i) => i.candidate);
  const forYouTracks = data.forYou.map((i) => i.candidate);

  const allPool = [
    ...(data.dailyRadar?.tracks ?? []),
    ...forYouTracks,
    ...moodTracks,
    ...deepTracks,
    ...familiarTracks
  ];
  const uniquePool = Array.from(
    new Map(allPool.map((t) => [providerTrackKey(t), t])).values()
  );

  const slowTracks = uniquePool.filter((track) => {
    const text = `${track.title} ${track.artist} ${track.album ?? ""} ${(track.tags ?? []).join(" ")}`.toLowerCase();
    return ["夜听", "深夜", "纯音乐", "轻音乐", "治愈", "r&b", "soul", "民谣", "lo-fi", "chill"].some((kw) => text.includes(kw));
  });

  const dailyMixes = [
    {
      id: "daily-mix-1",
      title: "Daily Mix 1 · 核心偏好",
      description: `精选最契合你听歌画像的常听歌手与代表作。${getArtistsExcerpt(familiarTracks.length ? familiarTracks : forYouTracks)}`,
      tags: ["Daily Mix", "常听", "精选", "偏好"],
      tracks: familiarTracks.length ? familiarTracks : forYouTracks
    },
    {
      id: "daily-mix-2",
      title: "Daily Mix 2 · 深度宝藏",
      description: `挖掘符合你品味但低热度的小众私藏曲目。${getArtistsExcerpt(deepTracks)}`,
      tags: ["Daily Mix", "深度", "宝藏", "小众"],
      tracks: deepTracks.length ? deepTracks : forYouTracks
    },
    {
      id: "daily-mix-3",
      title: "Daily Mix 3 · 探索律动",
      description: `跳出舒适圈，发现令人耳目一新的探索风味。${getArtistsExcerpt(moodTracks)}`,
      tags: ["Daily Mix", "探索", "新歌", "律动"],
      tracks: moodTracks.length ? moodTracks : forYouTracks
    },
    {
      id: "daily-mix-4",
      title: "Daily Mix 4 · 慢调私享",
      description: `舒缓慢调与治愈陪伴旋律，抚平思绪。${getArtistsExcerpt(slowTracks)}`,
      tags: ["Daily Mix", "夜听", "疗愈", "慢调"],
      tracks: slowTracks.length ? slowTracks : forYouTracks
    }
  ];

  const dynamicGroups = genreCategoryPresets.flatMap((preset) => {
    const matched = uniquePool.filter((track) => {
      const text = `${track.title} ${track.artist} ${track.album ?? ""} ${(track.tags ?? []).join(" ")}`.toLowerCase();
      return (preset.keywords ?? []).some((kw) => text.includes(kw.toLowerCase()));
    });
    if (matched.length < 2) return [];
    return [{
      id: `genre-${preset.id}`,
      title: preset.title,
      description: preset.description,
      tags: preset.tags,
      tracks: matched
    }];
  });

  const allGroups = [...dailyMixes, ...dynamicGroups];

  return allGroups.flatMap(({ id, title, description, tags, tracks }) => {
    if (!tracks.length) return [];
    const firstTrack = tracks[0]!;
    return [{
      playlist: {
        provider: firstTrack.provider,
        providerPlaylistId: `music-room-curated:${id}`,
        title,
        description,
        tags,
        artworkUrl: firstTrack.artworkUrl ?? null,
        creatorName: "Music Room",
        trackCount: tracks.length
      },
      tracks,
      score: 100,
      reasons: ["画像推荐"]
    } satisfies DiscoverPlaylistCard];
  });
}
