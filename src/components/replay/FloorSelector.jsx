export default function FloorSelector({ activeFloor, setActiveFloor }) {
  return (
    <div className="floor-selector">
      <button
          className={`floor-btn ${activeFloor === 'upper' ? 'active' : ''}`}
          style={{ marginRight: 4 }}
          onClick={(e) => { e.stopPropagation(); setActiveFloor('upper'); }}
      >
          Upper
      </button>
      <button
          className={`floor-btn ${activeFloor === 'lower' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setActiveFloor('lower'); }}
      >
          Lower
      </button>
    </div>
  );
}
