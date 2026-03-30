import Link from "next/link";
import type { Route } from "next";
import { TopBar } from "@/components/TopBar";

const features = [
  {
    title: "本地上传",
    body: "房主和成员都可以从本地选择歌曲，保留自己的曲库控制权，不依赖中心化音频托管。"
  },
  {
    title: "实时同听",
    body: "进入同一个房间后，播放状态、当前曲目和音频流保持同步，适合朋友一起听歌。"
  },
  {
    title: "房间协作",
    body: "房间里可以管理队列、保存歌单、查看成员与缓存状态，让听歌过程更像协作工作台。"
  }
];

const steps = [
  { index: "01", title: "确认昵称", body: "先确认身份，再进行建房或加房，房间关系和权限会更清晰。" },
  { index: "02", title: "创建或加入房间", body: "通过公开房间列表或房间码进入，快速组建同听空间。" },
  { index: "03", title: "上传并同听", body: "上传歌曲、加入队列、实时切歌和保存歌单，一次完成。" }
];

export function ProductLandingPage() {
  return (
    <main className="stage-shell">
      <TopBar />

      <section className="landing-hero">
        <div className="landing-hero__copy">
          <p className="landing-kicker">Music collaboration, not just playback</p>
          <h1>把本地曲库、房间同听和协作队列放进同一个网站。</h1>
          <p className="landing-lead">
            音乐房间是一套面向真实使用场景的轻量网站：先确认身份，再创建公开房间或通过房间码加入，
            然后上传歌曲、同步播放、保存歌单。
          </p>
          <div className="landing-actions">
            <Link href={"/rooms" as Route} className="landing-primary">
              进入房间主页
            </Link>
            <a href="#features" className="landing-secondary">
              查看核心能力
            </a>
          </div>
        </div>

        <div className="landing-preview">
          <div className="landing-preview__panel">
            <p className="landing-preview__label">实时房间工作台</p>
            <h2>一页完成上传、同听、队列与歌单。</h2>
            <ul className="landing-preview__list">
              <li>蓝色浅色系统，信息层级清晰</li>
              <li>队列抽屉与底部播放器长期可见</li>
              <li>成员、歌单、P2P 状态分列呈现</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="landing-section" id="features">
        <div className="landing-section__heading">
          <p className="landing-kicker">核心能力</p>
          <h2>面向真正落地使用的三条主链路</h2>
        </div>

        <div className="landing-feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="landing-card">
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--flow">
        <div className="landing-section__heading">
          <p className="landing-kicker">使用流程</p>
          <h2>三步进入一个可协作的音乐房间</h2>
        </div>

        <div className="landing-flow">
          {steps.map((step) => (
            <article key={step.index} className="landing-step">
              <span>{step.index}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--cta">
        <div className="landing-cta">
          <div>
            <p className="landing-kicker">多人同听</p>
            <h2>房间不是聊天页，而是一套真正能工作的听歌界面。</h2>
            <p>
              继续进入房间主页，确认昵称、查看公开房间、创建自己的房间，然后进入工作台开始测试。
            </p>
          </div>
          <Link href={"/rooms" as Route} className="landing-primary">
            立即开始
          </Link>
        </div>
      </section>
    </main>
  );
}
