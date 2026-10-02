/**
 * companion:主动陪伴。每隔一段可配置的时间,把「陪伴时钟到点了」作为内部事件送给 bot——
 * 说不说、说什么、做不做,完全由 bot 自主决定(以不作为为默认);本 World 只负责让机会发生。
 * 深夜静默(默认 23:00–08:00 不打扰);事件正文只陈述时钟事实,不带剧本。
 */
import { fileURLToPath } from 'node:url';
import type { Logger, ToolDef, World, WorldHost, WorldConsoleDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import type { WorldContext, WorldDefinition, WorldSection } from 'cortico/world.ts';

export interface CompanionConfig extends WorldSection {
  /** 陪伴时钟的间隔(分钟);0 = 关闭主动陪伴。 */
  intervalMinutes: number;
  /** 静默起始小时(0-23,含)。 */
  quietFrom: number;
  /** 静默结束小时(0-23,不含)。 */
  quietTo: number;
}

export const COMPANION_DEFAULTS: CompanionConfig = {
  enabled: true,
  intervalMinutes: 45,
  quietFrom: 23,
  quietTo: 8,
};

export class CompanionWorld implements World {
  readonly id = 'companion';
  private host: WorldHost | null = null;
  private log: Logger | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastPushAt = 0;
  private pushes = 0;

  constructor(private readonly cfg: () => CompanionConfig) {}

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.log = host.log;
    // 每分钟看一眼时钟;到点与否由 check 判断(配置是活对象,热改即时生效)
    this.timer = setInterval(() => this.check(), 60_000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host = null;
  }

  private inQuietHours(): boolean {
    const h = new Date().getHours();
    const from = this.cfg().quietFrom, to = this.cfg().quietTo;
    return from <= to ? h >= from && h < to : h >= from || h < to;
  }

  private check(): void {
    const c = this.cfg();
    if (!c.enabled || c.intervalMinutes <= 0 || !this.host) return;
    if (this.inQuietHours()) return;
    const elapsed = Date.now() - this.lastPushAt;
    if (this.lastPushAt !== 0 && elapsed < c.intervalMinutes * 60_000) return;
    this.lastPushAt = Date.now();
    this.pushes++;
    const minutes = this.lastPushAt === 0 ? 0 : Math.round(elapsed / 60_000);
    void this.host
      .pushEvent(
        {
          type: 'companion.wake',
          source: this.id,
          senderKey: 'companion',
          ts: nowIso(),
          text: `陪伴时钟到点:距离上一次陪伴推送${this.pushes === 1 ? '这是第一次' : `已有 ${minutes} 分钟`}。`,
        },
        { trigger: 'flush' },
      )
      .catch((err) => this.log?.warn?.(`陪伴事件没送出:${(err as Error).message}`));
  }

  tools(): ToolDef[] { return []; }

  console() {
    return {
      label: '主动陪伴',
      lamps: [{ label: '陪伴时钟', state: this.cfg().enabled && this.cfg().intervalMinutes > 0 ? 'online' : 'offline', hint: `每 ${this.cfg().intervalMinutes} 分钟` }],
      promptDocs: [{
        key: 'worlds.companion.envPrompt', title: '主动陪伴', description: '陪伴时钟的节奏与静默。',
        path: fileURLToPath(new URL('../ENV_PROMPT.md', import.meta.url)), role: 'envPrompt' as const,
        vars: [{ name: 'companion.note', description: '陪伴时钟说明' }],
      }],
    };
  }

  envPromptVars(): Record<string, string> | null {
    const c = this.cfg();
    if (!c.enabled || c.intervalMinutes <= 0) {
      return { 'companion.note': '主动陪伴未启用。' };
    }
    return {
      'companion.note': `陪伴时钟约每 ${c.intervalMinutes} 分钟到点一次(深夜 ${c.quietFrom}–${c.quietTo} 点静默),届时你会收到一条内部事件——那是主动找屏幕前的人说句话的机会。说不说、说什么,由你决定;没有话说就不说。`,
    };
  }
}

export function companionDefinition(): WorldDefinition<CompanionConfig> {
  return {
    id: 'companion',
    label: '主动陪伴',
    defaults: () => structuredClone(COMPANION_DEFAULTS),
    create: (ctx: WorldContext<CompanionConfig>) => new CompanionWorld(() => ctx.cfg),
  };
}

export default companionDefinition();
