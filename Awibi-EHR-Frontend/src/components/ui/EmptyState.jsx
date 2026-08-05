import React from 'react';

export default function EmptyState({ icon: Icon, title, description, action }) {
  const renderAction = () => {
    if (!action) return null;
    if (React.isValidElement(action)) return action;
    if (action.label && action.onClick) {
      return (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-[#2D5BFF] text-white rounded-lg text-sm font-medium hover:bg-[#1a45e0]"
        >
          {action.label}
        </button>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
          <Icon size={28} className="text-blue-400" />
        </div>
      )}
      <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 mb-6 max-w-xs">{description}</p>}
      {renderAction()}
    </div>
  );
}
