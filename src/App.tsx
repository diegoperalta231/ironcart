import { useEffect } from 'react';
import { Footer, Navbar, Toaster } from './components/Layout';
import SpotWidget from './components/SpotWidget';
import { StoreProvider } from './context/Store';
import { match, RouterProvider, useRouter } from './lib/router';
import { Catalog, Categories } from './pages/Catalog';
import { Cart, Checkout, OrderDetail, Orders } from './pages/Commerce';
import Home from './pages/Home';
import { About, Account, Contact, NotFound } from './pages/Info';
import ProductDetail from './pages/ProductDetail';

function Routes() {
  const { loc } = useRouter();
  const path = loc.pathname.replace(/\/+$/, '') || '/';

  useEffect(() => {
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [path]);

  let m: Record<string, string> | null;
  if (path === '/') return <Home />;
  if (path === '/productos') return <Catalog />;
  if (path === '/categorias') return <Categories />;
  if ((m = match('/producto/:slug', path))) return <ProductDetail slug={m.slug} />;
  if (path === '/carrito') return <Cart />;
  if (path === '/checkout') return <Checkout />;
  if (path === '/pedidos') return <Orders />;
  if ((m = match('/pedidos/:numero', path))) return <OrderDetail numero={m.numero} />;
  if (path === '/cuenta') return <Account />;
  if (path === '/nosotros') return <About />;
  if (path === '/contacto') return <Contact />;
  return <NotFound />;
}

export default function App() {
  return (
    <RouterProvider>
      <StoreProvider>
        <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded focus:bg-naranja focus:px-4 focus:py-2 focus:text-black">
          Saltar al contenido
        </a>
        <Navbar />
        <main id="contenido" className="min-h-[60vh]"><Routes /></main>
        <Footer />
        <SpotWidget />
        <Toaster />
      </StoreProvider>
    </RouterProvider>
  );
}
