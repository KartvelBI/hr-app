import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  UserGroupIcon,
  Briefcase01Icon,
  Agreement01Icon,
  ComputerIcon,
  ExchangeDollarIcon,
  ClipboardListIcon,
  Database01Icon,
  InboxIcon,
  BankIcon,
  SecurityCheckIcon,
} from '@hugeicons/core-free-icons';
import { loadSidebarOrder, loadHidden, useSidebarReorder, DOCS_SIDEBAR_ORDER_KEY, DOCS_SIDEBAR_DEFAULT, DOCS_SIDEBAR_HIDDEN_KEY } from '../Options/NavOrderSettings';
import HiringDocuments from './HiringDocuments';
import EmployeeList from '../Employees/EmployeeList';
import Agents from '../Accounting/Agents';
import Agreements from './Agreements';
import CurrencyRates from './CurrencyRates';
import JournalPage from './JournalPage';
import DataLake from './DataLake';
import Requests from './Requests';
import TbcBanking from '../Accounting/TbcBanking';
import RsGeIntegration from '../Accounting/RsGeIntegration';
import './Documents.css';

const TAB_KEYS = [
  { key: 'journal', labelKey: 'docs.journal', icon: (
    <HugeiconsIcon icon={ClipboardListIcon} size={16} color="#f59e0b" strokeWidth={1.8} />
  )},
  { key: 'employees', labelKey: 'docs.employees', icon: (
    <HugeiconsIcon icon={UserGroupIcon} size={16} color="#3b82f6" strokeWidth={1.8} />
  )},
  { key: 'agents', labelKey: 'docs.agents', icon: (
    <HugeiconsIcon icon={Briefcase01Icon} size={16} color="#8b5cf6" strokeWidth={1.8} />
  )},
  { key: 'agreements', labelKey: 'docs.agreements', icon: (
    <HugeiconsIcon icon={Agreement01Icon} size={16} color="#479c73" strokeWidth={1.8} />
  )},
  { key: 'devices', labelKey: 'docs.devices', icon: (
    <HugeiconsIcon icon={ComputerIcon} size={16} color="#f97316" strokeWidth={1.8} />
  )},
  { key: 'nbg-rates', labelKey: 'docs.nbgRates', icon: (
    <HugeiconsIcon icon={ExchangeDollarIcon} size={16} color="#06b6d4" strokeWidth={1.8} />
  )},
  { key: 'datalake', labelKey: 'docs.dataLake', icon: (
    <HugeiconsIcon icon={Database01Icon} size={16} color="#14b8a6" strokeWidth={1.8} />
  )},
  { key: 'requests', labelKey: 'docs.requests', icon: (
    <HugeiconsIcon icon={InboxIcon} size={16} color="#ef4444" strokeWidth={1.8} />
  )},
  { key: 'banking', labelKey: 'acc.banking', icon: (
    <HugeiconsIcon icon={BankIcon} size={16} color="#14b8a6" strokeWidth={1.8} />
  )},
  { key: 'rsge', labelKey: 'acc.rsge', icon: (
    <HugeiconsIcon icon={SecurityCheckIcon} size={16} color="#e11d48" strokeWidth={1.8} />
  )},
];

const CHEVRON_LEFT = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;
const CHEVRON_RIGHT = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>;

function DocumentsPage() {
  const { t } = useLanguage();
  const TABS = TAB_KEYS.map(tab => ({ ...tab, label: t(tab.labelKey) }));
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const order = loadSidebarOrder(DOCS_SIDEBAR_ORDER_KEY, DOCS_SIDEBAR_DEFAULT);
    return searchParams.get('tab') || order[0] || 'employees';
  });
  const [innerTab, setInnerTab] = useState(searchParams.get('inner') || 'hr');
  const [loadingTab, setLoadingTab] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('docs_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const [sidebarOrder, setSidebarOrder] = useState(() => loadSidebarOrder(DOCS_SIDEBAR_ORDER_KEY, DOCS_SIDEBAR_DEFAULT));
  const [hiddenTabs, setHiddenTabs] = useState(() => loadHidden(DOCS_SIDEBAR_HIDDEN_KEY));

  useEffect(() => {
    const sync = (e) => {
      if (!e.key || e.key === DOCS_SIDEBAR_ORDER_KEY) setSidebarOrder(loadSidebarOrder(DOCS_SIDEBAR_ORDER_KEY, DOCS_SIDEBAR_DEFAULT));
      if (!e.key || e.key === DOCS_SIDEBAR_HIDDEN_KEY) setHiddenTabs(loadHidden(DOCS_SIDEBAR_HIDDEN_KEY));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const handleTabChange = (key) => {
    if (key === activeTab) return;
    setLoadingTab(key);
    setTimeout(() => setLoadingTab(null), 280);
    setActiveTab(key);
  };

  const toggleSidebar = () => setCollapsed(v => {
    const next = !v;
    try { localStorage.setItem('docs_sidebar_collapsed', next); } catch {}
    return next;
  });

  const orderedTabs = [...TABS]
    .sort((a, b) => sidebarOrder.indexOf(a.key) - sidebarOrder.indexOf(b.key))
    .filter(tab => !hiddenTabs.has(tab.key));
  const { getItemProps } = useSidebarReorder(DOCS_SIDEBAR_ORDER_KEY, orderedTabs.map(tab => tab.key), setSidebarOrder);

  return (
    <div className="docs-layout">
      <aside className={`docs-sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="docs-sidebar-header">
          <span className="docs-sidebar-title">{t('docs.title')}</span>
          <button className="docs-sidebar-toggle" onClick={toggleSidebar} title={collapsed ? t('docs.expand') : t('docs.collapse')}>
            {collapsed ? CHEVRON_RIGHT : CHEVRON_LEFT}
          </button>
        </div>
        {orderedTabs.map((tab) => (
          <button
            key={tab.key}
            className={`docs-sidebar-btn${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
            title={collapsed ? tab.label : ''}
            {...getItemProps(tab.key)}
          >
            <span className="docs-sidebar-icon">{tab.icon}</span>
            <span className="docs-sidebar-btn-label">{tab.label}</span>
            {loadingTab === tab.key && !collapsed && <span className="fp-spinner" />}
          </button>
        ))}
      </aside>

      <main className="docs-content">
        <div key={activeTab} className="fp-tab-enter">
          {activeTab === 'journal' && <JournalPage />}
          {activeTab === 'employees' && <EmployeeList />}
          {activeTab === 'agents' && <Agents />}
          {activeTab === 'agreements' && <Agreements />}
          {activeTab === 'nbg-rates' && <CurrencyRates />}
          {activeTab === 'devices' && (
            <div className="docs-blank">
              <div className="docs-blank-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
              <h3>{t('docs.devices')}</h3>
              <p>{t('docs.devicesComingSoon')}</p>
            </div>
          )}
          {activeTab === 'datalake' && <DataLake />}
          {activeTab === 'requests' && <Requests />}
          {activeTab === 'banking' && <TbcBanking />}
          {activeTab === 'rsge' && <RsGeIntegration />}
        </div>
      </main>
    </div>
  );
}

export default DocumentsPage;
