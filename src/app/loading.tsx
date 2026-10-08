export default function Loading() {
  return (
    <div className="loading-page" aria-label="Loading your workspace">
      <div className="skeleton skeleton-nav" />
      <div className="skeleton-content">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-banner" />
        <div className="skeleton-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skeleton skeleton-card" key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
