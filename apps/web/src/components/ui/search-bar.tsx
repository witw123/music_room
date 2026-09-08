"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";

export interface SearchBarProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  className?: string;
  inputClassName?: string;
  prefixAction?: ReactNode;
  suffixAction?: ReactNode;
  showSearchButton?: boolean;
  searchButtonText?: string;
  searchButtonLoadingText?: string;
  dropdownContent?: ReactNode;
  "aria-label"?: string;
  size?: "default" | "sm" | "lg";
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  {
    id,
    name,
    value,
    onChange,
    onSubmit,
    onClear,
    onFocus,
    onBlur,
    onKeyDown,
    placeholder = "搜索歌曲、歌手、歌单或专辑",
    disabled = false,
    loading = false,
    autoFocus = false,
    maxLength = 100,
    className = "",
    inputClassName = "",
    prefixAction,
    suffixAction,
    showSearchButton = true,
    searchButtonText = "搜索",
    searchButtonLoadingText = "搜索中…",
    dropdownContent,
    "aria-label": ariaLabel = "搜索",
    size = "default"
  },
  forwardedRef
) {
  const [localValue, setLocalValue] = useState(value);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const isFocusedRef = useRef(false);
  const prevPropValueRef = useRef(value);
  useImperativeHandle(forwardedRef, () => internalInputRef.current as HTMLInputElement);

  useEffect(() => {
    if (prevPropValueRef.current !== value) {
      prevPropValueRef.current = value;
      if (!isComposingRef.current && value !== localValue) {
        setLocalValue(value);
      }
    }
  }, [value, localValue]);

  const handleSubmit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (disabled || loading) return;
    const domValue = internalInputRef.current?.value ?? "";
    const rawValue = (localValue || domValue || value).trim();
    if (!rawValue) {
      internalInputRef.current?.focus();
      return;
    }
    if (domValue && domValue !== value) {
      setLocalValue(domValue);
      onChange(domValue);
    }
    internalInputRef.current?.blur();
    onSubmit?.(rawValue);
  };

  const handleClear = () => {
    setLocalValue("");
    prevPropValueRef.current = "";
    onChange("");
    onClear?.();
    internalInputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const isComposing = isComposingRef.current || (event.nativeEvent as unknown as { isComposing?: boolean })?.isComposing;
    if (event.key === "Enter" && !isComposing) {
      event.preventDefault();
      handleSubmit();
      return;
    }
    onKeyDown?.(event);
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false;
    const domVal = internalInputRef.current?.value ?? event.currentTarget.value ?? "";
    setLocalValue(domVal);
    onChange(domVal);
    window.queueMicrotask(() => {
      if (internalInputRef.current && internalInputRef.current.value !== domVal) {
        const nextDomVal = internalInputRef.current.value;
        setLocalValue(nextDomVal);
        onChange(nextDomVal);
      }
    });
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = event.target.value;
    setLocalValue(nextVal);
    onChange(nextVal);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
    onFocus?.();
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    isComposingRef.current = false;
    const domVal = internalInputRef.current?.value ?? event.currentTarget.value;
    if (domVal !== undefined && domVal !== value) {
      setLocalValue(domVal);
      onChange(domVal);
    }
    onBlur?.();
  };

  const sizeClasses = {
    sm: "h-9 text-xs",
    default: "h-11 text-sm",
    lg: "h-12 text-base"
  }[size];

  return (
    <div className={`relative w-full ${className}`}>
      <form
        action="#"
        className="flex w-full min-w-0 items-center gap-2"
        onSubmit={handleSubmit}
        role="search"
      >
        <div
          className={`relative flex min-w-0 flex-1 items-center rounded-xl border border-white/[0.1] bg-black/40 px-2.5 shadow-sm transition-all focus-within:border-accent focus-within:bg-black/60 focus-within:ring-2 focus-within:ring-accent/20 ${sizeClasses} ${
            disabled ? "opacity-60 cursor-not-allowed" : ""
          }`}
        >
          {prefixAction ? (
            <div className="flex shrink-0 items-center mr-1">{prefixAction}</div>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center text-foreground-muted/60 mr-1.5"
            >
              <SearchIcon />
            </span>
          )}

          <div className="relative min-w-0 flex-1 h-full flex items-center">
            <input
              ref={internalInputRef}
              id={id}
              name={name}
              value={localValue}
              onChange={handleChange}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              autoFocus={autoFocus}
              maxLength={maxLength}
              type="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label={ariaLabel}
              className={`h-full w-full min-w-0 bg-transparent py-1 text-foreground placeholder:text-foreground-muted/40 outline-none ${inputClassName}`}
            />

            {localValue.trim() && !disabled ? (
              <button
                type="button"
                onClick={handleClear}
                onPointerDown={(e) => e.preventDefault()}
                aria-label="清空搜索内容"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-foreground-muted/50 transition hover:bg-white/10 hover:text-foreground"
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>

          {suffixAction ? (
            <div className="flex shrink-0 items-center ml-1.5">{suffixAction}</div>
          ) : null}
        </div>

        {showSearchButton ? (
          <button
            type="submit"
            disabled={disabled || loading}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") {
                e.preventDefault();
              }
            }}
            onClick={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className={`inline-flex min-h-[2.5rem] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:border-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${
              !localValue.trim() && !internalInputRef.current?.value?.trim() ? "opacity-50" : ""
            }`}
          >
            {loading ? (
              <>
                <SpinnerIcon />
                <span>{searchButtonLoadingText}</span>
              </>
            ) : (
              <span>{searchButtonText}</span>
            )}
          </button>
        ) : null}
      </form>

      {dropdownContent ? dropdownContent : null}
    </div>
  );
});

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        strokeDasharray="32"
        strokeDashoffset="12"
      />
    </svg>
  );
}
