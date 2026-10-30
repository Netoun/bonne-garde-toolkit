import { useCallback, useEffect, useRef, useState } from "react";

interface UseLoadAppReturn {
  showContent: boolean;
  contentOpacity: number;
  isInitialLoading: boolean;
  shouldShowLoader: boolean;
}

const CONTENT_SHOW_DELAY_MS = 700;
const CONTENT_OPACITY_DELAY_MS = 300;

function useLoadApp(isPending: boolean): UseLoadAppReturn {
  const [showContent, setShowContent] = useState(false);
  const [contentOpacity, setContentOpacity] = useState(0);

  const hasLoadedOnceRef = useRef(false);
  const previousIsPendingRef = useRef(isPending);
  const showContentRef = useRef(false);

  const handleContentShow = useCallback(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setShowContent(true);
  }, []);

  const handleContentOpacity = useCallback(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setContentOpacity(1);
  }, []);

  useEffect(() => {
    const wasPending = previousIsPendingRef.current;
    previousIsPendingRef.current = isPending;

    if (!isPending && !hasLoadedOnceRef.current) {
      hasLoadedOnceRef.current = true;

      const contentShowTimer = setTimeout(() => {
        if (!showContentRef.current) {
          showContentRef.current = true;
          handleContentShow();
        }

        const opacityTimer = setTimeout(() => {
          handleContentOpacity();
        }, CONTENT_OPACITY_DELAY_MS);

        return () => {
          clearTimeout(opacityTimer);
        };
      }, CONTENT_SHOW_DELAY_MS);

      return () => {
        clearTimeout(contentShowTimer);
      };
    } else if (!isPending && wasPending && hasLoadedOnceRef.current && !showContentRef.current) {
      showContentRef.current = true;

      handleContentShow();

      handleContentOpacity();
    }
  }, [isPending, handleContentShow, handleContentOpacity]);

  const isInitialLoading = isPending && !hasLoadedOnceRef.current;
  const shouldShowLoader = isInitialLoading || (!hasLoadedOnceRef.current && !showContent);

  return {
    showContent,
    contentOpacity,
    isInitialLoading,
    shouldShowLoader,
  };
}

export default useLoadApp;
