import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { Player } from './components/player';
import { TooltipProvider } from './components/ui/tooltip';
import { slideIds } from './lib/slides';
import { connectToProjection, createStandalonePresenter } from './lib/standalone-presenter';
import { useDocumentTitle } from './lib/use-document-title';
import { useSlideModule } from './lib/use-slide-module';
import { Presenter } from './routes/presenter';
import './styles.css';

function Projection({ slideId }: { slideId: string }) {
  const { slide, error } = useSlideModule(slideId);
  const [index, setIndex] = useState(0);
  const [presenter] = useState(() => createStandalonePresenter(slideId));
  useDocumentTitle(slide?.meta?.title ?? slideId);
  if (error || (slide && !slide.default?.length)) {
    return <div role="alert">{error ? error : 'This deck has no pages.'}</div>;
  }
  if (!slide?.default) return null;
  return (
    <Player
      pages={slide.default}
      index={index}
      onIndexChange={setIndex}
      design={slide.design}
      transition={slide.transition}
      controls
      slideId={slideId}
      fullscreen={false}
      allowExit={false}
      onExit={() => {}}
      presenter={presenter}
    />
  );
}

function StandalonePresenter() {
  const [query] = useSearchParams();
  const [transport] = useState(() => connectToProjection(query.get('session')));
  return <Presenter transport={transport} />;
}

const root = document.getElementById('root');
const [slideId] = slideIds;
if (root && slideId) {
  createRoot(root).render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delay={200}>
        <HashRouter>
          <Routes>
            <Route path="/s/:slideId/presenter" element={<StandalonePresenter />} />
            <Route path="*" element={<Projection slideId={slideId} />} />
          </Routes>
        </HashRouter>
      </TooltipProvider>
    </ThemeProvider>,
  );
}
