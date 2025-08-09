interface ToggleSliderProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}

export default function ToggleSlider({ 
  checked, 
  onChange, 
  label, 
  className = '',
  disabled = false 
}: ToggleSliderProps) {
  return (
    <label className={`flex items-center cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      {label && (
        <span className="mr-2 text-xs font-medium text-gray-600 dark:text-gray-400">
          {label}
        </span>
      )}
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
        />
        <div className={`block w-10 h-6 rounded-full transition-colors duration-200 ${
          checked 
            ? 'bg-blue-600 dark:bg-blue-500' 
            : 'bg-gray-300 dark:bg-gray-600'
        }`} />
        <div className={`absolute left-0.5 top-0.5 bg-white w-5 h-5 rounded-full transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </div>
    </label>
  );
}