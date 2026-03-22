'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

export default function WelcomeModal({ onClose }: { onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const [dontShow, setDontShow] = useState(false);

  const handleClose = () => {
    if (dontShow) localStorage.setItem('hide_welcome', 'true');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ 
        background: 'linear-gradient(135deg, rgba(30, 32, 40, 0.75) 0%, rgba(20, 22, 28, 0.85) 100%)',
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 24px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
        borderRadius: '16px',
        color: '#fff'
      }}>
        <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 16, marginBottom: 16 }}>
          <span style={{ fontWeight: 600, letterSpacing: '0.5px' }}>{t('welcome.title')}</span>
          <button className="btn btn-sm lang-toggle" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')} title="中/EN" style={{ fontSize: 12, background: 'rgba(255,255,255,0.1)', border: 'none' }}>
            {locale === 'zh' ? 'EN' : '中文'}
          </button>
        </h2>
        <div className="modal-body" style={{ color: 'rgba(255,255,255,0.85)' }}>
          <p style={{ lineHeight: 1.6 }}>{t('welcome.desc')}</p>
          <div style={{ margin: '20px 0', padding: 16, background: 'rgba(0,0,0,0.25)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
            <p style={{ fontWeight: 600, marginBottom: 12, color: 'var(--primary-light)' }}>{t('welcome.quickstart')}</p>
            <ol style={{ paddingLeft: 20, lineHeight: 2.2, fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
              <li>{t('welcome.step1')}</li>
              <li>{t('welcome.step2')}</li>
              <li>{t('welcome.step3')}</li>
              <li>{t('welcome.step4')}</li>
            </ol>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 16 }}>{t('welcome.tip')}</p>
        </div>
        <div className="modal-footer">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
            {t('welcome.dontShow')}
          </label>
          <button className="btn btn-primary" onClick={handleClose}>{t('welcome.gotIt')}</button>
        </div>
      </div>
    </div>
  );
}
