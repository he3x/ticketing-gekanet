/// <reference types="react" />
/// <reference types="react-dom" />

// Temporary type declarations for React until @types/react can be installed
// This file provides basic type support to resolve TypeScript errors

declare namespace React {
  type ReactNode = any;
  type ReactElement = any;
  type FC<P = {}> = (props: P) => ReactElement | null;
  type CSSProperties = any;
  
  interface HTMLAttributes<T> {
    className?: string;
    style?: CSSProperties;
    onClick?: (event: any) => void;
    onChange?: (event: any) => void;
    onSubmit?: (event: any) => void;
    children?: ReactNode;
    [key: string]: any;
  }
  
  interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }
  
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    type?: string;
    value?: string | number;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    id?: string;
  }
  
  interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    rows?: number;
    name?: string;
    id?: string;
  }
  
  interface SelectHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: string | number;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    id?: string;
  }
  
  interface SVGAttributes<T> extends HTMLAttributes<T> {
    fill?: string;
    stroke?: string;
    strokeWidth?: string | number;
    [key: string]: any;
  }
  
  namespace JSX {
    interface Element extends ReactElement {}
    
    interface IntrinsicElements {
      div: HTMLAttributes<HTMLDivElement>;
      span: HTMLAttributes<HTMLSpanElement>;
      button: HTMLAttributes<HTMLButtonElement>;
      input: HTMLAttributes<HTMLInputElement>;
      form: HTMLAttributes<HTMLFormElement>;
      label: HTMLAttributes<HTMLLabelElement>;
      select: HTMLAttributes<HTMLSelectElement>;
      option: HTMLAttributes<HTMLOptionElement>;
      textarea: HTMLAttributes<HTMLTextAreaElement>;
      h1: HTMLAttributes<HTMLHeadingElement>;
      h2: HTMLAttributes<HTMLHeadingElement>;
      h3: HTMLAttributes<HTMLHeadingElement>;
      h4: HTMLAttributes<HTMLHeadingElement>;
      h5: HTMLAttributes<HTMLHeadingElement>;
      h6: HTMLAttributes<HTMLHeadingElement>;
      p: HTMLAttributes<HTMLParagraphElement>;
      a: HTMLAttributes<HTMLAnchorElement>;
      img: HTMLAttributes<HTMLImageElement>;
      ul: HTMLAttributes<HTMLUListElement>;
      ol: HTMLAttributes<HTMLOListElement>;
      li: HTMLAttributes<HTMLLIElement>;
      table: HTMLAttributes<HTMLTableElement>;
      thead: HTMLAttributes<HTMLTableSectionElement>;
      tbody: HTMLAttributes<HTMLTableSectionElement>;
      tr: HTMLAttributes<HTMLTableRowElement>;
      th: HTMLAttributes<HTMLTableCellElement>;
      td: HTMLAttributes<HTMLTableCellElement>;
      svg: SVGAttributes<SVGSVGElement>;
      path: SVGAttributes<SVGPathElement>;
      circle: SVGAttributes<SVGCircleElement>;
      rect: SVGAttributes<SVGRectElement>;
      line: SVGAttributes<SVGLineElement>;
      [elemName: string]: any;
    }
  }
  
  interface FormEvent<T = Element> {
    preventDefault(): void;
    stopPropagation(): void;
    target: EventTarget & T;
    currentTarget: EventTarget & T;
  }
  
  interface MouseEvent<T = Element> {
    preventDefault(): void;
    stopPropagation(): void;
    target: EventTarget & T;
    currentTarget: EventTarget & T;
    clientX: number;
    clientY: number;
  }
  
  interface KeyboardEvent<T = Element> {
    preventDefault(): void;
    stopPropagation(): void;
    target: EventTarget & T;
    currentTarget: EventTarget & T;
    key: string;
    code: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
  }
  
  function useState<T>(initialState: T | (() => T)): [T, (newState: T | ((prev: T) => T)) => void];
  function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  function useRef<T>(initialValue: T): { current: T };
  function useMemo<T>(factory: () => T, deps: any[]): T;
  function useCallback<T extends (...args: any[]) => any>(callback: T, deps: any[]): T;
  
  const StrictMode: FC<{ children?: ReactNode }>;
}

declare module 'react' {
  export = React;
  export const StrictMode: React.FC<{ children?: React.ReactNode }>;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element): {
    render(element: React.ReactElement): void;
  };
}

declare module 'react/jsx-runtime' {
  export namespace JSX {
    interface Element extends React.ReactElement {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
  export function jsx(type: any, props: any, key?: any): React.ReactElement;
  export function jsxs(type: any, props: any, key?: any): React.ReactElement;
  export function Fragment(props: { children?: React.ReactNode }): React.ReactElement;
}

declare module 'cors' {
  import { RequestHandler } from 'express';
  function cors(options?: any): RequestHandler;
  export = cors;
}
