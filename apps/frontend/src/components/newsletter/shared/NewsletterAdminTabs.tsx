import { Tab, Tabs } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { label: 'Newsletters', path: '/admin/newsletter' },
  { label: 'Lists', path: '/admin/newsletter/lists' },
  { label: 'Subscribers', path: '/admin/newsletter/subscribers' },
] as const;

// Newsletters owns everything else under /admin/newsletter, including a single
// newsletter's page (/admin/newsletter/:newsletterId).
const activeTabPath = (pathname: string): string =>
  TABS.slice(1).find(
    tab => pathname === tab.path || pathname.startsWith(`${tab.path}/`)
  )?.path ?? TABS[0].path;

/** Switches between the three newsletter admin sections. */
const NewsletterAdminTabs = () => {
  const { pathname } = useLocation();

  return (
    <Tabs
      value={activeTabPath(pathname)}
      sx={{
        borderBottom: '1px solid #27272a',
        mb: 3,
        minHeight: 40,
        '& .MuiTabs-indicator': { bgcolor: '#f97316' },
      }}
    >
      {TABS.map(tab => (
        <Tab
          key={tab.path}
          value={tab.path}
          label={tab.label}
          component={Link}
          to={tab.path}
          sx={{
            textTransform: 'none',
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 40,
            color: '#a1a1aa',
            '&:hover': { color: '#e4e4e7' },
            '&.Mui-selected': { color: '#fb923c' },
          }}
        />
      ))}
    </Tabs>
  );
};

export default NewsletterAdminTabs;
