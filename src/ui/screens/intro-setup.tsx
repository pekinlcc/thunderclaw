import { useState } from 'react';
import { tbStyles } from '../styles';
import { ui } from '../messaging';

export function IntroSetupScreen({
  initialIntro,
  onDone,
}: {
  initialIntro: string;
  onDone: () => void;
}) {
  const [intro, setIntro] = useState(initialIntro);
  const [saving, setSaving] = useState(false);

  async function save(text: string) {
    setSaving(true);
    try {
      await ui.saveIntro(text);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        background: '#FBFBFC',
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      <div style={{ width: 560 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            style={{
              width: 52,
              height: 52,
              margin: '0 auto 14px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #1373D9 0%, #4A9FE5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
              boxShadow: '0 6px 20px rgba(19,115,217,0.25)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="6" r="2.5" stroke="#FFF" strokeWidth="1.6" />
              <path
                d="M3 13c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"
                stroke="#FFF"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, margin: '0 0 6px', fontWeight: 600 }}>
            简单介绍一下你自己
          </h1>
          <p style={{ fontSize: 13, color: tbStyles.textMuted, margin: 0, lineHeight: 1.5 }}>
            AI 写邮件回复时会参考这段话，让语气和身份更准。
            <br />
            可以跳过，AI 会从你的历史邮件里自己摸索。
          </p>
        </div>

        <div
          style={{
            background: '#FFF',
            border: `1px solid ${tbStyles.borderSoft}`,
            borderRadius: 10,
            padding: 16,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: tbStyles.textMuted,
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '.04em',
            }}
          >
            自我介绍 · 选填
          </div>
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            placeholder={
              '例：\n• 我是某公司的产品经理，主要跟设计师、研发、销售打交道\n• 邮件大多英文，对内偶尔中文\n• 周末不处理工作邮件'
            }
            style={{
              width: '100%',
              minHeight: 140,
              padding: 12,
              fontSize: 13,
              lineHeight: 1.65,
              fontFamily: tbStyles.font,
              color: tbStyles.text,
              border: `1px solid ${tbStyles.border}`,
              borderRadius: 6,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              background: '#FBFBFC',
            }}
          />
          <div style={{ fontSize: 11, color: tbStyles.textFaint, marginTop: 8 }}>
            之后可以在 设置 → AI 助手 里随时修改
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11.5, color: tbStyles.textFaint }}>
            内容只保留在本地，不会上传到任何服务器
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => save('')}
              disabled={saving}
              style={{
                padding: '7px 14px',
                fontSize: 12.5,
                background: '#FFF',
                color: tbStyles.text,
                border: `1px solid ${tbStyles.border}`,
                borderRadius: 5,
                cursor: saving ? 'wait' : 'pointer',
                font: 'inherit',
              }}
            >
              跳过
            </button>
            <button
              onClick={() => save(intro)}
              disabled={saving}
              style={{
                padding: '7px 16px',
                fontSize: 12.5,
                fontWeight: 500,
                background: tbStyles.blue,
                color: '#FFF',
                border: 'none',
                borderRadius: 5,
                cursor: saving ? 'wait' : 'pointer',
                font: 'inherit',
              }}
            >
              {saving ? '保存中…' : '保存并继续'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
