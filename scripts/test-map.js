/**
 * Playwright smoke test — Map View KidSpot
 * Testa: POIs ocultos, zoom sem crash, click no marker → MiniCard
 *
 * Executar: node scripts/test-map.js
 * Pré-requisito: servidor rodando em http://localhost:5000
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://localhost:5000";
const SCREENSHOTS_DIR = path.join(__dirname, "..", "test-screenshots");

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function screenshot(page, name) {
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 Screenshot salvo: test-screenshots/${name}.png`);
  return file;
}

async function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function run() {
  log("\n=== KidSpot Map View — Playwright Test ===\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro size
    // Geolocation falsa: São Paulo, SP
    geolocation: { latitude: -23.5505, longitude: -46.6333 },
    permissions: ["geolocation"],
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  // ── 1. Carregar a app ────────────────────────────────────────────────────
  log("1. Carregando a app em http://localhost:5000...");
  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await screenshot(page, "01-home-loaded");
  log("   ✅ App carregada");

  // ── 2. Aguardar busca automática (useHomeSearch auto-search) ─────────────
  log("2. Aguardando busca automática por localização...");
  // Espera o FlatList ou o loading sumir
  await page.waitForTimeout(4000);
  await screenshot(page, "02-after-autosearch");

  // Verifica se há resultados ou estado de erro
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes("lugares encontrados") || bodyText.includes("encontrado")) {
    log("   ✅ Resultados carregados");
  } else if (bodyText.includes("Localização atual") || bodyText.includes("KidScore")) {
    log("   ✅ Resultados visíveis (KidScore)");
  } else {
    log("   ⚠️  Resultado não detectado no texto — verificar screenshot 02");
  }

  // ── 3. Verificar botão de mapa no header ─────────────────────────────────
  log("3. Verificando botão toggle lista↔mapa...");
  // O botão só aparece após search.searched === true
  // accessibilityLabel="Ver mapa" no Pressable
  const mapToggleVisible = await page.locator('[aria-label="Ver mapa"]').isVisible({ timeout: 5000 }).catch(() => false);
  if (mapToggleVisible) {
    log("   ✅ Botão 'Ver mapa' visível no header");
  } else {
    log("   ⚠️  Botão 'Ver mapa' não encontrado — buscando outros indicadores");
    await screenshot(page, "03-no-toggle");
  }

  // ── 4. Abrir visualização em Mapa ─────────────────────────────────────────
  log("4. Abrindo visualização em mapa...");
  const toggleBtn = page.locator('[aria-label="Ver mapa"]');
  if (await toggleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await toggleBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, "04-map-view-opened");
    log("   ✅ Mapa aberto");
  } else {
    log("   ⚠️  Botão toggle não encontrado — tentando busca manual");
    // Tenta clicar no botão "Perto de mim" se disponível
    const nearbyBtn = page.locator('[aria-label="Perto de mim"]');
    if (await nearbyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nearbyBtn.click();
      await page.waitForTimeout(3000);
    }
    await screenshot(page, "04-map-attempt");
    log("   ⚠️  Continuando sem confirmar abertura do mapa");
  }

  // ── 5. TESTE 1: POIs nativos ocultos ─────────────────────────────────────
  log("\n── TESTE 1: POIs nativos do Google Maps ──");
  // Captura screenshot do mapa para inspeção visual
  await screenshot(page, "05-map-poi-test");
  // Verifica se a customMapStyle foi aplicada (indiretamente: DOM do mapa)
  const mapStyleApplied = await page.evaluate(() => {
    // react-native-maps no web cria um elemento de mapa do Google
    const mapEl = document.querySelector('[data-testid="map-view"]') ||
                  document.querySelector(".gm-style") ||
                  document.querySelector("[aria-roledescription='map']");
    return !!mapEl;
  });
  log(`   ${mapStyleApplied ? "✅" : "⚠️ "} Google Maps DOM element: ${mapStyleApplied ? "encontrado" : "não encontrado"}`);
  log("   📸 Screenshot 05 disponível para verificação visual dos POIs");

  // ── 6. TESTE 2: Zoom sem crash ────────────────────────────────────────────
  log("\n── TESTE 2: Zoom no mapa ──");
  const errsBefore = pageErrors.length;

  // Localiza o mapa
  const mapContainer = page.locator('[data-testid="map-view"], .gm-style, [aria-roledescription="map"]').first();
  const mapExists = await mapContainer.isVisible({ timeout: 3000 }).catch(() => false);

  if (mapExists) {
    const box = await mapContainer.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      log("   Executando scroll zoom in × 3...");
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, -300); // scroll up = zoom in
        await page.waitForTimeout(400);
      }
      await screenshot(page, "06-after-zoom-in");

      log("   Executando scroll zoom out × 3...");
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, 300); // scroll down = zoom out
        await page.waitForTimeout(400);
      }
      await screenshot(page, "07-after-zoom-out");
    }
  } else {
    log("   ⚠️  Container do mapa não localizado para zoom");
    await screenshot(page, "06-zoom-not-found");
  }

  await page.waitForTimeout(1000);
  const errsAfter = pageErrors.length;
  const newErrors = pageErrors.slice(errsBefore);

  if (newErrors.length === 0) {
    log("   ✅ Nenhum crash/page error durante zoom");
  } else {
    log(`   ❌ Erros durante zoom (${newErrors.length}):`);
    newErrors.forEach((e) => log(`      - ${e.substring(0, 200)}`));
  }

  // ── 7. TESTE 3: Click em marcador → MiniCard ─────────────────────────────
  log("\n── TESTE 3: Click em marcador → MiniCard ──");
  await screenshot(page, "08-before-marker-click");

  // Tenta clicar num marcador (ícone de localização laranja)
  // No web, markers são renderizados como elementos DOM no overlay do Google Maps
  const markerEl = page.locator(
    '[data-testid="map-marker"], .gm-style img[src*="marker"], [role="button"][aria-label], .gm-style [style*="cursor: pointer"]'
  ).first();

  const markerFound = await markerEl.isVisible({ timeout: 3000 }).catch(() => false);

  if (markerFound) {
    log("   Clicando em marcador...");
    await markerEl.click({ force: true });
    await page.waitForTimeout(1500);
    await screenshot(page, "09-after-marker-click");

    // Verifica se o MiniCard apareceu (contém KidScore ou nome de lugar)
    const miniCardVisible = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes("KidScore") || text.includes("★") || text.includes("chevron");
    });
    if (miniCardVisible) {
      log("   ✅ MiniCard apareceu após click no marcador");
    } else {
      log("   ⚠️  MiniCard pode não ter aparecido — verificar screenshot 09");
    }
  } else {
    log("   ⚠️  Marcador não encontrado via seletor — tentando clique por coordenada no mapa");
    // Clique no centro do mapa onde marcadores devem estar
    const mapArea = page.locator(".gm-style, [aria-roledescription='map']").first();
    if (await mapArea.isVisible({ timeout: 2000 }).catch(() => false)) {
      const box = await mapArea.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1500);
        await screenshot(page, "09-map-center-click");
      }
    }
  }

  // ── 8. Resumo ─────────────────────────────────────────────────────────────
  log("\n=== RESUMO ===");

  if (consoleErrors.length > 0) {
    log(`\n⚠️  Console errors (${consoleErrors.length}):`);
    consoleErrors.slice(0, 5).forEach((e) => log(`   - ${e.substring(0, 200)}`));
  } else {
    log("✅ Nenhum console.error durante o teste");
  }

  if (pageErrors.length > 0) {
    log(`\n❌ Page errors (crashes) (${pageErrors.length}):`);
    pageErrors.forEach((e) => log(`   - ${e.substring(0, 300)}`));
  } else {
    log("✅ Nenhum page error (crash) durante o teste");
  }

  log(`\nScreenshots salvos em: test-screenshots/`);
  log("Abra os screenshots para verificação visual dos POIs e do MiniCard.\n");

  await browser.close();

  if (pageErrors.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("ERRO NO TESTE:", err);
  process.exit(1);
});
