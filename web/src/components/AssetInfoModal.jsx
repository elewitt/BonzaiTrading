import AssetDetailPanel from "./AssetDetailPanel.jsx";

export default function AssetInfoModal({ symbol, name, category, onClose }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box card asset-info-modal">
        <AssetDetailPanel symbol={symbol} name={name} category={category} onClose={onClose} />
      </div>
    </div>
  );
}
