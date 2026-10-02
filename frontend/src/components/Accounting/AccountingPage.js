import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadSidebarOrder, loadHidden, useSidebarReorder, ACC_SIDEBAR_ORDER_KEY, ACC_SIDEBAR_DEFAULT, ACC_SIDEBAR_HIDDEN_KEY } from '../Options/NavOrderSettings';
import { useLanguage } from '../../contexts/LanguageContext';
import Purchases from './Purchases';
import Sales from './Sales';
import Projects from './Projects';
import Invoices from './Invoices';
import SalariesPage from './SalariesPage';
import Bookkeeping from './Bookkeeping';
import Transfers from './Transfers';
import PaymentCalendar from './PaymentCalendar';
import Stock from './Stock';
import FinBotsPage from './FinBotsPage';
import JetPage from './JetPage';
import Orders from '../Documents/Orders';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Book01Icon,
  ShoppingCart01Icon,
  SaleTag01Icon,
  Invoice01Icon,
  MoneyBag01Icon,
  Package01Icon,
  Calendar03Icon,
  ArrowDataTransferHorizontalIcon,
  ChatSpark01Icon,
  ClipboardListIcon,
  Folder01Icon,
} from '@hugeicons/core-free-icons';
import './Accounting.css';

const accIcon = (icon, color) => <HugeiconsIcon icon={icon} size={16} color={color} strokeWidth={1.8} />;

const ICONS = {
  purchases:     accIcon(ShoppingCart01Icon, '#f97316'),
  sales:         accIcon(SaleTag01Icon, '#479c73'),
  projects:      accIcon(Folder01Icon, '#0ea5e9'),
  invoices:      accIcon(Invoice01Icon, '#3b82f6'),
  salaryAccrual: accIcon(MoneyBag01Icon, '#8b5cf6'),
  bookkeeping:   accIcon(Book01Icon, '#6366f1'),
  stock:         accIcon(Package01Icon, '#f59e0b'),
  calendar:      accIcon(Calendar03Icon, '#ec4899'),
  transfers:     accIcon(ArrowDataTransferHorizontalIcon, '#06b6d4'),
  orders:        accIcon(ClipboardListIcon, '#f97316'),
  finbot:        accIcon(ChatSpark01Icon, '#ec4899'),
  jet: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/>
    </svg>
  ),
};

const TAB_KEYS = [
  { key: 'bookkeeping',    labelKey: 'acc.bookkeeping', icon: ICONS.bookkeeping },
  { key: 'purchases',      labelKey: 'acc.purchases',   icon: ICONS.purchases },
  { key: 'sales',          labelKey: 'acc.sales',       icon: ICONS.sales },
  { key: 'projects',       labelKey: 'acc.projects',    icon: ICONS.projects },
  { key: 'invoices',       labelKey: 'acc.invoices',    icon: ICONS.invoices },
  { key: 'salary-accrual', labelKey: 'acc.salaries',    icon: ICONS.salaryAccrual },
  { key: 'stock',          labelKey: 'acc.stock',       icon: ICONS.stock },
  { key: 'calendar',       labelKey: 'acc.calendar',    icon: ICONS.calendar },
  { key: 'transfers',      labelKey: 'acc.transfers',   icon: ICONS.transfers },
  { key: 'orders',        labelKey: 'docs.orders',     icon: ICONS.orders },
  { key: 'ai-agent',      labelKey: 'docs.finbot',     icon: ICONS.finbot },
  { key: 'jet',           labelKey: 'acc.jet',         icon: ICONS.jet },
];

const CHEVRON_LEFT = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15,18 9,12 15,6"/>
  </svg>
);
const CHEVRON_RIGHT = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9,18 15,12 9,6"/>
  </svg>
);

function AccountingPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOrder, setSidebarOrder] = useState(() => loadSidebarOrder(ACC_SIDEBAR_ORDER_KEY, ACC_SIDEBAR_DEFAULT));
  const [hiddenTabs, setHiddenTabs] = useState(() => loadHidden(ACC_SIDEBAR_HIDDEN_KEY));
  // The first non-hidden tab in the user's own configured sidebar order
  // (Options > Operations Sidebar), not a hardcoded default -- this is
  // what "Operations" in the top nav should land on.
  const firstConfiguredTab = () => sidebarOrder.find(key => !hiddenTabs.has(key) && TAB_KEYS.some(tb => tb.key === key)) || 'bookkeeping';
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || firstConfiguredTab());
  const [loadingTab, setLoadingTab] = useState(null);
  const TABS = TAB_KEYS.map(tab => ({ ...tab, label: t(tab.labelKey) }));

  useEffect(() => {
    const sync = (e) => {
      if (!e.key || e.key === ACC_SIDEBAR_ORDER_KEY) setSidebarOrder(loadSidebarOrder(ACC_SIDEBAR_ORDER_KEY, ACC_SIDEBAR_DEFAULT));
      if (!e.key || e.key === ACC_SIDEBAR_HIDDEN_KEY) setHiddenTabs(loadHidden(ACC_SIDEBAR_HIDDEN_KEY));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  // Clicking "Operations" in the top nav always links to the bare path
  // (no ?tab=) -- if this page is already mounted, that doesn't remount
  // it, so the initial-state default above wouldn't re-fire. Catch that
  // case here too, and make the resolved tab explicit in the URL.
  useEffect(() => {
    if (!searchParams.get('tab')) {
      const key = firstConfiguredTab();
      setActiveTab(key);
      setSearchParams({ tab: key }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const orderedTabs = [...TABS]
    .sort((a, b) => sidebarOrder.indexOf(a.key) - sidebarOrder.indexOf(b.key))
    .filter(tab => !hiddenTabs.has(tab.key));
  const { getItemProps } = useSidebarReorder(ACC_SIDEBAR_ORDER_KEY, orderedTabs.map(tab => tab.key), setSidebarOrder);

  const handleTabChange = (key) => {
    if (key === activeTab) return;
    setLoadingTab(key);
    setTimeout(() => setLoadingTab(null), 280);
    setActiveTab(key);
    setSearchParams({ tab: key }, { replace: true });
  };
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('acc_sidebar_collapsed') === 'true'; } catch { return false; }
  });

  const toggleSidebar = () => setCollapsed(v => {
    const next = !v;
    try { localStorage.setItem('acc_sidebar_collapsed', next); } catch {}
    return next;
  });

  return (
    <div className="acc-layout">
      <aside className={`acc-sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="acc-sidebar-header">
          <span className="acc-sidebar-title">{t('acc.title')}</span>
          <button className="acc-sidebar-toggle" onClick={toggleSidebar} title={collapsed ? t('acc.expand') : t('acc.collapse')}>
            {collapsed ? CHEVRON_RIGHT : CHEVRON_LEFT}
          </button>
        </div>
        {orderedTabs.map((tab) => (
          <button
            key={tab.key}
            className={`acc-sidebar-btn${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
            title={collapsed ? tab.label : ''}
            {...getItemProps(tab.key)}
          >
            <span className="acc-sidebar-icon">{tab.icon}</span>
            <span className="acc-sidebar-btn-label">{tab.label}</span>
            {loadingTab === tab.key && !collapsed && <span className="fp-spinner" />}
          </button>
        ))}
      </aside>
      <main className="acc-content">
        <div key={activeTab} className="fp-tab-enter">
          {activeTab === 'purchases'      && <Purchases />}
          {activeTab === 'sales'          && <Sales />}
          {activeTab === 'projects'       && <Projects />}
          {activeTab === 'invoices'       && <Invoices />}
          {activeTab === 'salary-accrual' && <SalariesPage />}
          {activeTab === 'bookkeeping'    && <Bookkeeping />}
          {activeTab === 'stock'          && <Stock />}
          {activeTab === 'calendar'       && <PaymentCalendar />}
          {activeTab === 'transfers'      && <Transfers />}
          {activeTab === 'orders'         && <Orders />}
          {activeTab === 'ai-agent'       && <FinBotsPage />}
          {activeTab === 'jet'            && <JetPage />}
        </div>
      </main>
    </div>
  );
}

export default AccountingPage;
