# 02 · P2P Mesh 重构

> 目标文件：`apps/web/src/features/p2p/mesh.ts`
> 优先级：P1 · 风险：中 · 状态：提案

## 1. 现状

| 指标 | 数值 |
|---|---|
| 行数 | 1655 |
| 顶层结构 | 单个 `P2PMesh` 类 + ~11 个模块级函数 |
| 类方法数 | **67**（上帝类） |
| `setInterval` | 2 |

已完成的第一步：帧编解码已抽到 `piece-frame-codec.ts`（见 git 历史，mesh.ts 从 1836→1655）。
本方案是该方向的延续。

`P2PMesh` 目前一肩挑起：信令收发（offer/answer/candidate）、RTCPeerConnection 生命周期、
data channel 管理、分片帧编解码调度、重连/健康监测、诊断上报。67 个方法混在一个类里，
改一处要理解全局。

## 2. 根因
- **单一类承担 6+ 个职责**，内聚性低、耦合度高。
- 与播放层不同，mesh **没有 React effect 依赖问题**（它是纯 TS 类），所以风险来源不是
  竞态，而是**可读性与改动安全性**——67 方法的类难以 review，改动易产生意外副作用。

## 3. 目标架构：按协作关系拆分

```
P2PMesh (瘦门面, ~300 行)
   │  对外仍暴露现有公共 API，内部委托给下面的协作者
   ├──► SignalingTransport      offer/answer/candidate 收发与去抖
   ├──► PeerConnectionRegistry  RTCPeerConnection 创建/缓存/销毁/状态
   ├──► DataChannelManager      data channel 打开/关闭/背压/bufferedAmount
   ├──► PieceFrameCodec         帧编解码（已抽出，继续内聚）
   └──► MeshHealthMonitor       重连、心跳、健康度、诊断上报（含 2 个定时器）
```

**门面保持兼容**：`P2PMesh` 的公共方法签名不变，`use-room-data-mesh.ts` /
`use-room-realtime-connection.ts` 等调用方零改动。内部把实现委托给协作者。

## 4. 拆分优先序（每步独立、行为不变）

1. **PieceFrameCodec**（已完成）——纯函数，零风险，已验证。
2. **SignalingTransport**——offer/answer/candidate 的构造、发送、去抖、失败处理。相对独立，
   下一个抽。
3. **DataChannelManager**——channel 生命周期 + 背压。依赖 PeerConnectionRegistry，第三步。
4. **PeerConnectionRegistry**——RTCPeerConnection 的 Map 管理与状态机。核心，放较后。
5. **MeshHealthMonitor**——把 2 个定时器（重连/心跳）收进来，集中管理生命周期。

## 5. 分阶段实施

- **阶段 0**：确认 `mesh.test.ts`（现 ~9 组）覆盖了信令握手、data channel、重连路径；
  缺口先补测试。
- **阶段 1~5**：按上面优先序逐个抽协作者，每抽一个：新建文件 + `P2PMesh` 内部委托 +
  跑 `mesh.test.ts`。调用方与测试**零改动**（门面兼容）。
- **阶段 6**：清理 `mesh.ts` 里遗留的 `as any`（如 `frame.header as any`）与死代码。

## 6. 风险与回滚
- 风险中等：`PeerConnectionRegistry` 抽离涉及 RTCPeerConnection 状态机，需谨慎。
- 每个协作者一个独立 commit，`mesh.test.ts` 绿即安全，可逐个 revert。

## 7. 成功判据
- `P2PMesh` 类方法数从 67 降到 ~20（门面 + 编排），其余分散到 5 个内聚协作者。
- 每个协作者 < 400 行，各自有单测。
- 信令/连接/重连行为与重构前逐位一致（由 `mesh.test.ts` 保证）。
