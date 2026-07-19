# 本地存储仓库设计

状态：`设计中`

最后更新：`2026-07-19`

## 1. 目标与边界

Music Room 是浏览器端应用。用户选择的目录属于当前浏览器用户的本地仓库，
用于保存歌曲、播放资产、本地歌单和可选的封面/歌词。服务端仍然只保存房间、
队列、播放状态和歌曲元数据，不保存音频文件。

本设计的目标是：

- 清空浏览器 IndexedDB 后，可以从目录重建本地曲库和播放能力；
- 重新选择同一个目录后，可以识别原有仓库，而不是重新导入所有歌曲；
- 原始音频、播放分片、歌曲元数据和本地歌单有明确的所有权和生命周期；
- 目录损坏、写入中断、转码中断时不会破坏整个曲库；
- 保留用户目录中原有的音乐文件，不移动、不删除、不覆盖。

以下内容不写入用户选择的目录：

- 登录 token、Session、网易云 Cookie、QQ 音乐 Cookie；
- 服务端房间状态、网络歌单和聊天记录；
- 服务端数据库、Redis 数据和运行日志。

## 2. 存储分层

目录文件是可迁移仓库的权威数据，IndexedDB 只承担索引和运行时加速职责。

| 数据 | 权威位置 | IndexedDB 中的用途 |
| --- | --- | --- |
| 原始音频 | `.music-room/library/sources` 或外部相对路径 | 播放前的临时 Blob、快速读取 |
| 原始资产 manifest | `.music-room/assets/original` | 资产索引和分片重建 |
| Opus 播放分片 | `.music-room/assets/playback` | 播放调度的快速读取 |
| 歌曲元数据 | `.music-room/catalog/tracks` | 曲库列表和搜索索引 |
| 本地歌单 | `.music-room/catalog/playlists` | UI 查询缓存 |
| 转码任务 | `.music-room/jobs` | 可恢复任务状态 |
| Provider 临时文件 | `.music-room/cache` | 可删除缓存 |

所有本地内容以完整的音频内容 SHA-256 `fileHash` 作为稳定身份。房间中的
`trackId`、`roomId` 只作为引用和清理依据，不能作为本地文件名或唯一身份。

## 3. 目录结构

用户选择的目录作为仓库根目录。Music Room 自己的内容全部放在 `.music-room`
下；根目录下已有的音乐目录和文件继续由用户管理。

```text
<selected-root>/
├── .music-room/
│   ├── repository.json
│   ├── catalog/
│   │   ├── index.json
│   │   ├── tracks/
│   │   │   └── <fileHash>.json
│   │   └── playlists/
│   │       └── <playlistId>.json
│   ├── library/
│   │   ├── sources/
│   │   │   └── <hash-prefix>/<fileHash>.<ext>
│   │   ├── artwork/
│   │   │   └── <contentHash>.<ext>
│   │   └── lyrics/
│   │       └── <fileHash>.txt
│   ├── assets/
│   │   ├── original/
│   │   │   └── <assetId>/manifest.json
│   │   └── playback/
│   │       └── <profileId>/<assetId>/
│   │           ├── manifest.json
│   │           └── units/
│   │               ├── 000000.opus
│   │               └── 000001.opus
│   ├── cache/
│   │   ├── provider/<provider>/<fileHash>.<ext>
│   │   ├── artwork/<contentHash>.<ext>
│   │   └── previews/<fileHash>.<ext>
│   ├── jobs/<fileHash>.json
│   ├── tmp/
│   └── trash/<yyyy-mm>/<operation-id>/
└── 用户原有的音乐文件和目录/
```

目录名约定：

- `library/sources`：需要保留的原始音频。文件名可读性不影响身份，建议使用
  `<fileHash>.<ext>`，避免标题修改导致内容丢失或重复；
- `assets/original`：原始资产 manifest，不保存第二份原始音频；manifest 指向
  `library/sources` 或一个外部相对路径；
- `assets/playback`：当前 `opus-music-v2` 的可播放分片。播放分片是可重建数据，
  但默认持久化，避免每次恢复都重新编码；
- `cache`：没有稳定引用或明确保留意图的临时数据，只允许由垃圾回收清理；
- `tmp`：只存未完成文件，正常读取时必须忽略；
- `trash`：删除操作的短期回收站，确认成功后再清空。

不再新增 `local/`、`saved/`、`cache/` 三个平级音频目录。存储类别由 manifest
中的字段表达，而不是由多个互相重叠的目录表达。

## 4. 仓库标识文件

`.music-room/repository.json` 是仓库识别和格式升级的入口：

```json
{
  "format": "music-room-local-repository",
  "schemaVersion": 1,
  "repositoryId": "5d3b2c5c-8c0a-4f6f-92c6-000000000000",
  "hashAlgorithm": "sha256",
  "playbackProfiles": {
    "opus-music-v2": {
      "encoderVersion": "2.0.0",
      "segmentDurationMs": 2000
    }
  },
  "createdAt": "2026-07-19T00:00:00.000Z",
  "updatedAt": "2026-07-19T00:00:00.000Z"
}
```

文件中不能保存绝对路径、浏览器目录句柄或当前用户 Session。`repositoryId`
用于防止用户误选另一个目录；目录句柄失效后，用户重新授权同一目录即可恢复。

## 5. 歌曲记录

`.music-room/catalog/tracks/<fileHash>.json` 保存一份内容记录：

```json
{
  "schemaVersion": 1,
  "fileHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "title": "歌曲名",
  "artist": "歌手",
  "album": "专辑",
  "durationMs": 240000,
  "mimeType": "audio/mpeg",
  "sizeBytes": 12345678,
  "sourceType": "local_upload",
  "sourceRef": null,
  "source": {
    "kind": "managed",
    "relativePath": ".music-room/library/sources/01/012345...mp3"
  },
  "originalAsset": {
    "assetId": "abcdef...",
    "manifestPath": ".music-room/assets/original/abcdef.../manifest.json"
  },
  "playbackAsset": {
    "assetId": "fedcba...",
    "profileId": "opus-music-v2",
    "manifestPath": ".music-room/assets/playback/opus-music-v2/fedcba.../manifest.json"
  },
  "artworkPath": ".music-room/library/artwork/abcdef....jpg",
  "lyricsPath": ".music-room/library/lyrics/012345....txt",
  "retention": "library",
  "createdAt": "2026-07-19T00:00:00.000Z",
  "updatedAt": "2026-07-19T00:00:00.000Z"
}
```

`source.kind` 有两种：

```json
{ "kind": "managed", "relativePath": ".music-room/library/sources/01/....mp3" }
```

```json
{
  "kind": "external",
  "relativePath": "Artist/Album/Song.mp3",
  "sizeBytes": 12345678,
  "lastModified": 1750000000000
}
```

外部文件不复制进仓库，也不由 Music Room 删除。读取时必须校验路径仍位于仓库
根目录内；文件不存在时只标记为 `missing`，不能删除曲目元数据。

Provider 字段仍使用共享模型的 `sourceType` 和 `sourceRef`。远程封面 URL 可以
保留在元数据中，但离线恢复不能依赖 URL；需要离线展示时才将图片写入
`library/artwork`。

## 6. 资产文件

### 6.1 原始资产

`assets/original/<assetId>/manifest.json` 保存当前共享模型中的完整
`OriginalAssetManifest`，并增加仓库存储信息：

```json
{
  "storageSchemaVersion": 1,
  "manifest": {
    "assetId": "...",
    "kind": "original",
    "fileHash": "...",
    "mimeType": "audio/mpeg",
    "sizeBytes": 12345678,
    "unitSize": 1048576,
    "unitCount": 12,
    "merkleRoot": "..."
  },
  "sourcePath": ".music-room/library/sources/01/...mp3"
}
```

v1 不再保存一份重复的原始 `assetUnits`。恢复 IndexedDB 时从原始文件按
`unitSize` 重新建立分片索引；原始文件本身才是权威数据。

### 6.2 播放资产

`assets/playback/<profileId>/<assetId>/manifest.json` 保存完整的
`PlaybackAssetManifest` 和每个分片的描述：

```json
{
  "storageSchemaVersion": 1,
  "manifest": {
    "assetId": "...",
    "kind": "playback",
    "sourceFileHash": "...",
    "profileId": "opus-music-v2",
    "codec": "opus",
    "container": "audio/ogg",
    "sampleRate": 48000,
    "channels": 2,
    "bitrate": 192000,
    "durationMs": 240000,
    "segmentDurationMs": 2000,
    "seekPrerollMs": 80,
    "unitCount": 120,
    "merkleRoot": "...",
    "encoder": { "name": "@audio/opus-encode", "version": "2.0.0" }
  },
  "units": [
    {
      "unitIndex": 0,
      "relativePath": "units/000000.opus",
      "payloadBytes": 24000,
      "contentHash": "...",
      "proof": [],
      "startMs": 0,
      "durationMs": 2000,
      "trimStartSamples": 0,
      "trimEndSamples": 0
    }
  ]
}
```

`manifest` 内的共享资产对象必须通过现有 Zod schema 校验；存储层新增字段
放在外层，不能修改共享 manifest 的语义。

## 7. 本地歌单

本地歌单从 `localStorage` 迁移到 `.music-room/catalog/playlists/<id>.json`：

```json
{
  "schemaVersion": 1,
  "id": "local-playlist-...",
  "title": "本地歌单",
  "description": "收藏的歌曲",
  "trackRefs": [
    { "kind": "content", "fileHash": "..." },
    { "kind": "provider", "provider": "netease", "trackId": "123" }
  ],
  "createdAt": "2026-07-19T00:00:00.000Z",
  "updatedAt": "2026-07-19T00:00:00.000Z"
}
```

`trackRefs` 允许歌单保留尚未离线下载的 Provider 曲目。没有 `fileHash` 的条目
显示为在线条目，不应被误认为本地可播放文件。

网络歌单继续由服务端管理，不复制到本地仓库。

## 8. 写入、一致性和恢复

所有写入操作都通过一个 `LocalRepository` 适配层完成，页面和上传流水线不直接
操作目录句柄。建议提供以下能力：

```text
openRepository(handle)
readTrack(fileHash)
writeManagedSource(file, metadata)
writeOriginalManifest(manifest)
writePlaybackAsset(manifest, units)
readSource(fileHash)
readPlaybackUnit(assetId, unitIndex)
upsertPlaylist(playlist)
rebuildIndexedDb()
collectGarbage(references)
```

写入顺序：

1. 在 `tmp` 写入 `<operation-id>.partial`；
2. 流式计算并校验 SHA-256、文件大小和 MIME；
3. 将完整文件移动或重写到最终路径；
4. 写入资产 manifest；
5. 最后写入歌曲记录或歌单记录；
6. 更新 `catalog/index.json`。

任何 `.partial`、无 manifest 的资产目录和状态为 `running` 但超时的任务，都可以
在启动时清理或重新排队。不能在 manifest 写入前将文件展示为可用。

同一浏览器的多标签页写入需要使用 Web Locks API 的固定锁名，例如
`music-room-local-repository`。目录权限不足、磁盘空间不足或写入失败时，必须保留
旧文件和旧 manifest，不得先删除再写入。

## 9. IndexedDB 重建

重新选择目录或检测到 IndexedDB 为空时：

1. 校验 `.music-room/repository.json`；
2. 扫描 `catalog/tracks` 和 `catalog/playlists`；
3. 验证原始文件路径、大小，必要时校验 SHA-256；
4. 导入原始 manifest 和播放 manifest；
5. 播放分片按需或后台导入 IndexedDB；
6. 原始资产按需重新切分为当前 `assetUnits`；
7. 重建 `cachedTrackLibraryMetadata`、`localPlaylistTracks` 等索引；
8. 对缺失文件标记 `availableOffline: false`，不删除记录。

IndexedDB 中的 `Blob`、`assetUnits`、缓存摘要和目录句柄都不能成为唯一数据源。

## 10. 缓存与垃圾回收

垃圾回收的保留集合至少包括：

- 本地歌单引用的 `fileHash`；
- 当前房间曲目引用的 `fileHash`；
- 当前用户拥有且可能继续发布的播放资产；
- 正在播放或正在转码的资产；
- `retention: library` 的原始文件。

只有不在保留集合中、超过最短保留时间且位于 `cache` 或无引用资产目录中的文件，
才能移入 `trash`。清理成功后再删除对应的目录记录和 IndexedDB 索引。

## 11. 旧版本迁移

首次选择目录时按以下顺序迁移：

1. 若存在 `.music-room/repository.json`，按 `schemaVersion` 执行升级；
2. 识别现有 `local/`、`cache/`、`saved/` 和根目录音频文件；
3. 通过实际内容 SHA-256 建立新的 `fileHash`；
4. `localAudioFiles` / `localAudioCacheFiles` 决定文件的保留策略；
5. `cachedTrackLibrary` 的元数据迁移为 `catalog/tracks/*.json`；
6. IndexedDB 中完整的播放资产迁移到 `assets/playback`；
7. `localStorage` 的 `music-room-local-playlists` 迁移到 `catalog/playlists`；
8. 每个文件写入并校验成功后，旧文件才允许进入 `trash`；
9. 迁移失败的单个文件保留原位置，并在仓库索引中标记迁移错误。

迁移期间不能清空旧 IndexedDB 数据。只有新仓库能够完整读取后，才允许删除
旧的重复 Blob 和废弃目录。

## 12. 与当前代码的对应关系

当前 `localAudioDirectory` 只保存目录句柄；它应继续保留，但新增仓库 ID、格式版本
和最后一次校验结果。`cachedTrackLibrary`、`assetManifests`、`assetUnits`、
`trackAssetLinks`、`transcodeJobs` 和 `localPlaylistTracks` 都应改为由仓库适配层
读写并回填，而不是继续各自定义一套文件规则。

目录扫描必须把当前的“路径 + 大小 + 修改时间”标识升级为真实内容 SHA-256；路径、
大小和修改时间只能作为避免重复读取的扫描提示。

实现顺序建议为：

1. `LocalRepository` 和 `repository.json`；
2. 原始音频、歌曲 manifest 和本地歌单；
3. 播放资产 manifest 与 Opus 分片；
4. IndexedDB 重建和迁移；
5. 缓存垃圾回收、回收站和多标签页写锁；
6. 封面、歌词及其他可选缓存。
