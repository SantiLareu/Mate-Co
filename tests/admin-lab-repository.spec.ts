/**
 * T1 — Repositorio local de diseños aprobados: validación pura (sin DOM).
 *
 * Cubre el sobre versionado, el aislamiento por registro (lo válido se
 * preserva aunque haya corrupción vecina), IDs duplicados, metadatos y
 * geometría inválida, versión desconocida, JSON malformado y topes de
 * almacenamiento. La E/S de localStorage (cuota, no disponible) se prueba en
 * navegador en admin-lab.spec.ts porque necesita window.
 */
import { expect, test } from "@playwright/test";
import {
  checkDesignGeometry,
  tokenizePathData,
  measureControlledPaths,
} from "../src/admin-lab/geometry";
import {
  ADMIN_LAB_LIMITS,
  ADMIN_LAB_STORAGE_KEY,
  createAdminDesignStore,
  DESIGN_MODEL_VERSION,
  MODEL_VERSION_ASSET,
  parseEnvelope,
  validateStoredDesign,
  type StorageBackend,
} from "../src/admin-lab/repository";
import type { LegacyApprovedDesign as ApprovedDesign } from "../src/admin-lab/types";
import {
  DEFAULT_CONTROLLED_STYLE,
  type ImportedGeometry,
} from "../src/admin-lab/importedGeometry";

function controlledGeometry(): ImportedGeometry {
  const paths = [
    {
      d: "M10 10H90V90H10Z",
      matrix: { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 },
      style: {
        ...DEFAULT_CONTROLLED_STYLE,
        fill: "#123456",
        stroke: "red",
        strokeWidth: 2,
        dasharray: [2, 3],
        fillRule: "evenodd" as const,
      },
    },
  ];
  const measured = measureControlledPaths(paths);
  if (!measured.ok) throw new Error(measured.reason);
  return {
    version: 2,
    root: 0,
    paths,
    nodes: [
      { kind: "group", opacity: 0.5, children: [1] },
      { kind: "path", opacity: 0.7, path: 0 },
    ],
    centerlineBounds: measured.centerlineBounds,
    artBounds: measured.artBounds,
  };
}

const v2Design = (id = "v2") => ({
  version: 2,
  id,
  name: "Color",
  category: "Arte",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  geometry: controlledGeometry(),
});

const memoryBackend = (
  seed: Record<string, string> = {},
  hooks: { onSet?: (key: string, value: string) => void } = {},
): StorageBackend => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      hooks.onSet?.(key, value);
      data.set(key, value);
    },
    removeItem: (key) => void data.delete(key),
  };
};

const validDesign = (
  overrides: Partial<ApprovedDesign> = {},
): ApprovedDesign => ({
  version: 1,
  id: "dis-1",
  name: "Guarda clásica",
  category: "Guardas",
  paths: [{ d: "M10 10H90V90H10Z" }],
  artBounds: { x: 10, y: 10, width: 80, height: 80 },
  fillRule: "nonzero",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const envelope = (records: unknown[], version = 1): string =>
  JSON.stringify({ version, records });

const storedSquare = (id: string): ApprovedDesign =>
  validDesign({
    id,
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
  });

test("v1 y v2 se cargan, normalizan y mutan sin perder el formato legado", async () => {
  const legacy = validDesign({
    id: "legacy",
    fillRule: "evenodd",
    paths: [{ d: "M10 10H90V90H10Z", transform: "translate(10 20) scale(2)" }],
    artBounds: { x: 30, y: 40, width: 160, height: 160 },
  });
  const raw = envelope([legacy, v2Design()]);
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
  const store = createAdminDesignStore(backend);
  const loaded = await store.load();
  expect(loaded.corrupted).toBe(false);
  expect(loaded.designs.map((d) => d.version)).toEqual([1, 2]);
  const normalized = (
    loaded.designs[0] as unknown as { geometry: ImportedGeometry }
  ).geometry;
  expect(normalized.paths[0].d).toBe(legacy.paths[0].d);
  expect(normalized.paths[0].matrix).toEqual({
    a: 2,
    b: 0,
    c: 0,
    d: 2,
    e: 10,
    f: 20,
  });
  expect(normalized.paths[0].style).toEqual({
    ...DEFAULT_CONTROLLED_STYLE,
    fillRule: "evenodd",
  });
  expect(normalized.nodes).toEqual([
    { kind: "group", opacity: 1, children: [1] },
    { kind: "path", opacity: 1, path: 0 },
  ]);
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
  expect((await store.updateDesign("v2", { name: "Color editado" })).ok).toBe(
    true,
  );
  expect((await store.toggleDesign("legacy")).ok).toBe(true);
  const persisted = JSON.parse(backend.getItem(ADMIN_LAB_STORAGE_KEY)!);
  expect(persisted.version).toBe(1);
  expect(persisted.records[0]).toEqual({ ...legacy, enabled: false });
  expect(persisted.records[1].geometry).toEqual(controlledGeometry());
  const reloaded = await createAdminDesignStore(backend).load();
  expect(reloaded.designs.map((d) => d.name)).toEqual([
    legacy.name,
    "Color editado",
  ]);
  const saved = await store.saveNew({
    name: "Nuevo",
    category: "Arte",
    geometry: controlledGeometry(),
  } as never);
  expect(saved.ok && saved.design.version).toBe(2);
  expect((await store.load()).designs).toHaveLength(3);
});

test("older v2 exact unfiltered envelope reloads tightly in memory beside v1 without rewriting", async () => {
  const old = v2Design("old-v2");
  old.geometry.paths = [
    {
      d: "M0 0H10V10H0Z",
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      style: { ...DEFAULT_CONTROLLED_STYLE },
    },
    {
      d: "M10000 10000H10010V10010H10000Z",
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      style: { ...DEFAULT_CONTROLLED_STYLE, fill: "none" },
    },
  ];
  old.geometry.nodes = [
    { kind: "group", opacity: 1, children: [1, 2] },
    { kind: "path", opacity: 1, path: 0 },
    { kind: "path", opacity: 1, path: 1 },
  ];
  old.geometry.centerlineBounds = { x: 0, y: 0, width: 10010, height: 10010 };
  old.geometry.artBounds = { ...old.geometry.centerlineBounds };
  const invisible = structuredClone(old);
  invisible.id = "all-invisible";
  invisible.geometry.nodes[0].opacity = 0;
  const raw = envelope([validDesign({ id: "legacy" }), old, invisible]);
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
  const store = createAdminDesignStore(backend);
  const loaded = await store.load();
  expect(loaded.corrupted).toBe(false);
  expect(loaded.designs.map((d) => d.id)).toEqual([
    "legacy",
    "old-v2",
    "all-invisible",
  ]);
  const geometry = (
    loaded.designs[1] as unknown as { geometry: ImportedGeometry }
  ).geometry;
  expect(geometry.artBounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  expect(geometry.paths).toEqual(old.geometry.paths);
  expect(geometry.nodes).toEqual(old.geometry.nodes);
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
  expect((await store.updateDesign("old-v2", { name: "Editado" })).ok).toBe(
    true,
  );
  const reloaded = await createAdminDesignStore(backend).load();
  expect(reloaded.corrupted).toBe(false);
  expect(
    JSON.parse(backend.getItem(ADMIN_LAB_STORAGE_KEY)!).records[0],
  ).toEqual(validDesign({ id: "legacy" }));
  const arbitrary = structuredClone(old);
  arbitrary.geometry.artBounds.width++;
  const huge = structuredClone(old);
  huge.geometry.paths[1].d = "M0 0H1000001V10Z";
  const corrupt = parseEnvelope(
    envelope([
      validDesign({ id: "before" }),
      arbitrary,
      { ...huge, id: "huge" },
      v2Design("after"),
    ]),
  );
  expect(corrupt.designs.map((d) => d.id)).toEqual(["before", "after"]);
  expect(corrupt.skipped).toHaveLength(2);
});

test("v2 corrupto: pintura, matrices, referencias, null y bounds se aíslan sin reescribir", async () => {
  const corruptions: Array<(g: ImportedGeometry) => void> = [
    (g) => {
      g.paths[0].style.fill = "url(https://evil.example/p)";
    },
    (g) => {
      g.paths[0].style.stroke = "javascript:alert(1)";
    },
    (g) => {
      g.paths[0].style.fillOpacity = 2;
    },
    (g) => {
      g.paths[0].matrix.a = 1e9;
    },
    (g) => {
      g.paths[0].matrix = null as never;
    },
    (g) => {
      g.nodes[0] = { kind: "group", opacity: 1, children: [0] };
    },
    (g) => {
      g.nodes[1] = { kind: "path", opacity: 1, path: 4 };
    },
    (g) => {
      g.nodes[1] = null as never;
    },
    (g) => {
      g.paths[0] = null as never;
    },
    (g) => {
      g.artBounds.width = 1;
    },
    (g) => {
      g.centerlineBounds.x = 0;
    },
  ];
  for (const corrupt of corruptions) {
    const bad = v2Design("bad");
    corrupt(bad.geometry);
    const raw = envelope([
      validDesign({ id: "before" }),
      bad,
      v2Design("after"),
    ]);
    const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
    const store = createAdminDesignStore(backend);
    const loaded = await store.load();
    expect(loaded.designs.map((d) => d.id)).toEqual(["before", "after"]);
    expect(loaded.skipped).toHaveLength(1);
    expect(loaded.corrupted).toBe(true);
    expect((await store.toggleDesign("before")).ok).toBe(false);
    expect((await store.removeDesign("bad")).ok).toBe(false);
    expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
  }
});

test("v2 proyecta solo props controladas antes de almacenar y renderizar", () => {
  const candidate = v2Design();
  Object.assign(candidate.geometry.paths[0], {
    onclick: "alert(1)",
    href: "https://evil.example",
  });
  Object.assign(candidate.geometry.paths[0].style, {
    filter: "url(https://evil.example)",
  });
  const checked = validateStoredDesign(candidate);
  expect(checked.ok).toBe(true);
  if (checked.ok)
    expect(
      (checked.design as unknown as { geometry: ImportedGeometry }).geometry,
    ).toEqual(controlledGeometry());
});

function wideGeometry(nodeCount = 6000): ImportedGeometry {
  const g = controlledGeometry();
  g.nodes = [
    {
      kind: "group",
      opacity: 1,
      children: Array.from({ length: nodeCount - 1 }, (_, i) => i + 1),
    },
    ...Array.from({ length: nodeCount - 2 }, () => ({
      kind: "group" as const,
      opacity: 1,
      children: [],
    })),
    { kind: "path", opacity: 1, path: 0 },
  ];
  return g;
}

test("v2 acota árboles por registro y aísla el inválido sin ocultar vecinos", () => {
  const tooWide = { ...v2Design("wide"), geometry: wideGeometry(10_001) };
  const parsed = parseEnvelope(
    envelope([v2Design("before"), tooWide, v2Design("after")]),
  );
  expect(parsed.designs.map((d) => d.id)).toEqual(["before", "after"]);
  expect(parsed.skipped).toHaveLength(1);
});

test("v2 limita trabajo agregado del árbol antes de validar y bloquea escrituras irrecargables", async () => {
  const records = Array.from({ length: 11 }, (_, i) => ({
    ...v2Design(`wide-${i}`),
    geometry: wideGeometry(),
  }));
  const oversized = envelope(records);
  const parsed = parseEnvelope(oversized);
  expect(parsed.corrupted).toBe(true);
  expect(parsed.designs).toHaveLength(8);
  expect(parsed.skipped[0].reason).toContain("trabajo acumulado");
  const seed = envelope(records.slice(0, 8));
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: seed });
  const store = createAdminDesignStore(backend);
  expect((await store.load()).corrupted).toBe(false);
  const result = await store.saveNew({
    name: "Extra",
    category: "Arte",
    geometry: wideGeometry(),
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("STORAGE_FULL");
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(seed);
});

test("registros de versión desconocida también son solo lectura", async () => {
  const raw = envelope([
    v2Design("known"),
    { ...v2Design("future"), version: 99 },
  ]);
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
  const store = createAdminDesignStore(backend);
  expect((await store.load()).designs.map((d) => d.id)).toEqual(["known"]);
  expect((await store.updateDesign("known", { name: "Editado" })).ok).toBe(
    false,
  );
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
});

test("guardar v2 con bounds falsos o estilo corrupto no escribe", async () => {
  let writes = 0;
  const store = createAdminDesignStore(
    memoryBackend(
      {},
      {
        onSet: () => {
          writes++;
        },
      },
    ),
  );
  const geometry = controlledGeometry();
  geometry.artBounds.width = 1;
  expect(
    (await store.saveNew({ name: "Malo", category: "Arte", geometry })).ok,
  ).toBe(false);
  geometry.paths[0].style.stroke = "url(#stored)";
  expect(
    (await store.saveNew({ name: "Malo", category: "Arte", geometry })).ok,
  ).toBe(false);
  expect(writes).toBe(0);
});

test("clave de almacenamiento versionada y estable", () => {
  expect(ADMIN_LAB_STORAGE_KEY).toContain("admin-lab");
  expect(ADMIN_LAB_STORAGE_KEY).toContain("v1");
});

test("sobre vacío o ausente carga cero diseños sin corrupción", () => {
  for (const raw of [null, "", "  "]) {
    const parsed = parseEnvelope(raw);
    expect(parsed.designs).toEqual([]);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.corrupted).toBe(false);
    expect(parsed.unknownVersion).toBe(false);
  }
});

test("JSON malformado no rompe: cero diseños y marca corrupción", () => {
  const parsed = parseEnvelope("{no-json");
  expect(parsed.designs).toEqual([]);
  expect(parsed.corrupted).toBe(true);
  expect(parsed.skipped.length).toBeGreaterThan(0);
});

test("versión desconocida no se interpreta: se conserva sin migrar ni borrar", () => {
  const parsed = parseEnvelope(envelope([validDesign()], 99));
  expect(parsed.designs).toEqual([]);
  expect(parsed.unknownVersion).toBe(true);
  expect(parsed.corrupted).toBe(true);
});

test("registros válidos se preservan y los corruptos se aíslan con motivo", () => {
  const parsed = parseEnvelope(
    envelope([
      validDesign({ id: "ok-1" }),
      {
        version: 1,
        id: "sin-nombre",
        name: "  ",
        category: "X",
        paths: [{ d: "M0 0H1V1Z" }],
        artBounds: { x: 0, y: 0, width: 1, height: 1 },
        fillRule: "nonzero",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      validDesign({ id: "ok-2", name: "Flor" }),
      null,
      "texto",
    ]),
  );
  expect(parsed.designs.map((design) => design.id)).toEqual(["ok-1", "ok-2"]);
  expect(parsed.corrupted).toBe(true);
  expect(parsed.skipped.length).toBe(3);
  for (const skipped of parsed.skipped)
    expect(skipped.reason.length).toBeGreaterThan(0);
});

test("IDs duplicados: se conserva el primero y se omite el repetido", () => {
  const parsed = parseEnvelope(
    envelope([
      validDesign({ id: "dup" }),
      validDesign({ id: "dup", name: "Otra" }),
    ]),
  );
  expect(parsed.designs.map((design) => design.id)).toEqual(["dup"]);
  expect(parsed.designs[0].name).toBe("Guarda clásica");
  expect(
    parsed.skipped.some((entry) =>
      entry.reason.toLowerCase().includes("duplicado"),
    ),
  ).toBe(true);
});

test("geometría almacenada inválida se rechaza antes de renderizar", () => {
  const badPath = validateStoredDesign(
    validDesign({ paths: [{ d: "M10 10 L" }] }),
  );
  expect(badPath.ok).toBe(false);

  const badTransform = validateStoredDesign(
    validDesign({ paths: [{ d: "M0 0H1V1Z", transform: "warp(1)" }] }),
  );
  expect(badTransform.ok).toBe(false);

  const badBounds = validateStoredDesign(
    validDesign({ artBounds: { x: 0, y: 0, width: 0, height: 0 } }),
  );
  expect(badBounds.ok).toBe(false);

  const badFillRule = validateStoredDesign(
    validDesign({ fillRule: "inherit" as never }),
  );
  expect(badFillRule.ok).toBe(false);

  const noRawSvg = validateStoredDesign({ ...validDesign(), svg: "<svg/>" });
  expect(noRawSvg.ok).toBe(false);
});

test("metadatos inválidos se rechazan con motivo claro", () => {
  expect(validateStoredDesign(validDesign({ name: "" })).ok).toBe(false);
  expect(validateStoredDesign(validDesign({ category: "" })).ok).toBe(false);
  expect(validateStoredDesign(validDesign({ id: "" })).ok).toBe(false);
  expect(validateStoredDesign(validDesign({ enabled: "sí" as never })).ok).toBe(
    false,
  );
  expect(validateStoredDesign(validDesign({ createdAt: "ayer" })).ok).toBe(
    false,
  );
  expect(validateStoredDesign(validDesign({ paths: [] })).ok).toBe(false);
  expect(validateStoredDesign(null).ok).toBe(false);
});

test("topes de almacenamiento declarados y positivos", () => {
  expect(ADMIN_LAB_LIMITS.MAX_RECORDS).toBeGreaterThan(0);
  expect(ADMIN_LAB_LIMITS.MAX_STORAGE_CHARS).toBeGreaterThan(
    ADMIN_LAB_LIMITS.MAX_RECORDS,
  );
});

// ---- Correcciones M4/M5/S1/S5: gramática estricta y geometría exacta ----

test("basura al final del d se rechaza (no se ignora en silencio)", () => {
  expect(tokenizePathData("M0 0 L10 10 Z hello").ok).toBe(false);
  expect(
    validateStoredDesign(validDesign({ paths: [{ d: "M0 0 L10 10 Z hello" }] }))
      .ok,
  ).toBe(false);
  expect(
    validateStoredDesign(validDesign({ paths: [{ d: "M10 10 L" }] })).ok,
  ).toBe(false);
  expect(
    validateStoredDesign(validDesign({ paths: [{ d: "M0 0 L10 10 Z 42" }] }))
      .ok,
  ).toBe(false);
});

test("exponente malformado se rechaza (no se reinterpreta)", () => {
  expect(tokenizePathData("M0 0L1e 5").ok).toBe(false);
  expect(
    validateStoredDesign(validDesign({ paths: [{ d: "M0 0L1e 5" }] })).ok,
  ).toBe(false);
});

test("coordenadas enormes se rechazan aunque el d sea sintáctico", () => {
  const checked = validateStoredDesign(
    validDesign({ paths: [{ d: "M0 0L1e9 1e9Z" }] }),
  );
  expect(checked.ok).toBe(false);
  if (!checked.ok) expect(checked.reason).toMatch(/rango|volumen/i);
});

test("matriz gigante con caja falsa 1x1 se rechaza (caja derivada, no confiada)", () => {
  const checked = validateStoredDesign(
    validDesign({
      paths: [{ d: "M0 0H1V1H0Z", transform: "matrix(1e8 0 0 1e8 0 0)" }],
      artBounds: { x: 0, y: 0, width: 1, height: 1 },
    }),
  );
  expect(checked.ok).toBe(false);
});

test("overflow por composición (scale 1e200 dos veces) se rechaza", () => {
  const checked = validateStoredDesign(
    validDesign({
      paths: [{ d: "M0 0H1V1H0Z", transform: "matrix(1e200 0 0 1e200 0 0)" }],
    }),
  );
  expect(checked.ok).toBe(false);
});

test("flags de arco compactados se rechazan con motivo explícito (no se deforman)", () => {
  const tokenized = tokenizePathData("M10 80A45 45 0 01125 80");
  expect(tokenized.ok).toBe(true);
  if (tokenized.ok) expect(tokenized.path.packedArcFlags).toBe(true);
  const checked = checkDesignGeometry([{ d: "M10 80A45 45 0 01125 80" }]);
  expect(checked.ok).toBe(false);
  if (!checked.ok) expect(checked.reason).toMatch(/compactados|separador/);
});

test("arco con flags separados se admite con bounds exactos", () => {
  const checked = checkDesignGeometry([{ d: "M0 0A50 50 0 0 1 100 0" }]);
  expect(checked.ok).toBe(true);
  if (checked.ok) {
    // Semicírculo superior exacto: la muestra aproximada lo recortaría.
    expect(checked.bounds.x).toBeCloseTo(0, 6);
    expect(checked.bounds.y).toBeCloseTo(-50, 6);
    expect(checked.bounds.width).toBeCloseTo(100, 6);
    expect(checked.bounds.height).toBeCloseTo(50, 6);
  }
});

test("curva cúbica: bounds exactos por extremos, no caja de controles", () => {
  const checked = checkDesignGeometry([{ d: "M0 0C50 100 50 100 100 0" }]);
  expect(checked.ok).toBe(true);
  if (checked.ok) {
    // B(0.5).y = 75: exacto 75, la caja de controles daría 100.
    expect(checked.bounds.height).toBeCloseTo(75, 6);
    expect(checked.bounds.width).toBeCloseTo(100, 6);
  }
});

test("presupuestos: path individual, total y costo abortan sin reservar", () => {
  const huge = "M0 0" + "L1 1".repeat(300_000);
  expect(checkDesignGeometry([{ d: huge }]).ok).toBe(false);
  const manyArcs = Array.from(
    { length: 25_000 },
    () => "M0 0A10 10 0 0 1 20 0",
  ).join(" ");
  const over = checkDesignGeometry([{ d: manyArcs }]);
  expect(over.ok).toBe(false);
  if (!over.ok) expect(over.code).toBe("DESIGN_TOO_LARGE");
  const bigTotal = [
    { d: "M0 0H10V10H0Z".padEnd(1_100_000, " ") },
    { d: "M0 0H10V10H0Z".padEnd(1_100_000, " ") },
  ];
  expect(checkDesignGeometry(bigTotal).ok).toBe(false);
});

// ---- Corrección S6: cotas de lectura del sobre ----

test("sobre crudo gigante no se parsea: corrupto e intacto", () => {
  const parsed = parseEnvelope(
    `{"version":1,"records":[${"1,".repeat(2_000_000)}]}`,
  );
  expect(parsed.designs).toEqual([]);
  expect(parsed.corrupted).toBe(true);
});

test("miles de registros se acotan: como máximo 200 en lista", () => {
  const records = Array.from({ length: 5000 }, (_, i) =>
    storedSquare(`d-${i}`),
  );
  const parsed = parseEnvelope(JSON.stringify({ version: 1, records }));
  expect(parsed.designs.length).toBeLessThanOrEqual(
    ADMIN_LAB_LIMITS.MAX_RECORDS,
  );
  expect(parsed.corrupted).toBe(true);
  expect(parsed.skipped.length).toBeGreaterThan(0);
});

// ---- Correcciones M3/L8/L9: CRUD real con backend inyectado ----

test("CRUD completo con MemoryStorage: alta, lectura, edición, toggle y borrado", async () => {
  const store = createAdminDesignStore(memoryBackend());
  const saved = await store.saveNew({
    name: "Guarda",
    category: "Guardas",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero",
  });
  expect(saved.ok).toBe(true);
  if (!saved.ok) return;
  const id = saved.design.id;
  expect((await store.load()).designs.map((d) => d.id)).toEqual([id]);

  const updated = await store.updateDesign(id, { name: "Guarda fina" });
  expect(updated.ok && updated.design?.name).toBe("Guarda fina");

  const toggled = await store.toggleDesign(id);
  expect(toggled.ok && toggled.design?.enabled).toBe(false);
  const toggledBack = await store.toggleDesign(id);
  expect(toggledBack.ok && toggledBack.design?.enabled).toBe(true);

  const removed = await store.removeDesign(id);
  expect(removed.ok).toBe(true);
  expect((await store.load()).designs).toEqual([]);
});

test("IDs generados no colisionan y not found es claro", async () => {
  const store = createAdminDesignStore(memoryBackend());
  const input = {
    name: "G",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero" as const,
  };
  const first = await store.saveNew(input);
  const second = await store.saveNew(input);
  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok) expect(first.design.id).not.toBe(second.design.id);
  expect((await store.updateDesign("inexistente", { name: "X" })).ok).toBe(
    false,
  );
  expect((await store.toggleDesign("inexistente")).ok).toBe(false);
  expect((await store.removeDesign("inexistente")).ok).toBe(false);
});

test("tope de registros bloquea el alta 201 sin borrar nada", async () => {
  const backend = memoryBackend();
  const seedRecords = Array.from({ length: 200 }, (_, i) =>
    storedSquare(`d-${i}`),
  );
  backend.setItem(
    ADMIN_LAB_STORAGE_KEY,
    JSON.stringify({ version: 1, records: seedRecords }),
  );
  const store = createAdminDesignStore(backend);
  const result = await store.saveNew({
    name: "Uno más",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("LIMIT_RECORDS");
  expect((await store.load()).designs.length).toBe(200);
});

test("sobre corrupto es solo lectura: mutar no sobrescribe el blob", async () => {
  const corrupt = "{no-json";
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: corrupt });
  const store = createAdminDesignStore(backend);
  const input = {
    name: "N",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero" as const,
  };
  for (const attempt of [
    store.saveNew(input),
    store.updateDesign("x", { name: "Y" }),
    store.toggleDesign("x"),
    store.removeDesign("x"),
  ]) {
    expect((await attempt).ok).toBe(false);
  }
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(corrupt);
  // Sobre mixto válido+corrupto: también bloquea para no perder lo dañado.
  const mixed = JSON.stringify({
    version: 1,
    records: [storedSquare("ok-1"), { version: 1, id: "roto" }],
  });
  const backend2 = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: mixed });
  const store2 = createAdminDesignStore(backend2);
  expect((await store2.load()).designs.map((d) => d.id)).toEqual(["ok-1"]);
  expect((await store2.saveNew(input)).ok).toBe(false);
  expect(backend2.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(mixed);
});

test("cuota agotada y backend ausente nunca afirman guardado", async () => {
  const quotaBackend: StorageBackend = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    },
    removeItem: () => undefined,
  };
  const quotaStore = createAdminDesignStore(quotaBackend);
  const quotaResult = await quotaStore.saveNew({
    name: "N",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero",
  });
  expect(quotaResult.ok).toBe(false);
  if (!quotaResult.ok) expect(quotaResult.error.code).toBe("STORAGE_QUOTA");

  const missingStore = createAdminDesignStore(null);
  expect((await missingStore.load()).unavailable).toBe(true);
  expect(
    (
      await missingStore.saveNew({
        name: "N",
        category: "C",
        paths: [{ d: "M10 10H90V90H10Z" }],
        artBounds: { x: 10, y: 10, width: 80, height: 80 },
        fillRule: "nonzero",
      })
    ).ok,
  ).toBe(false);
});

test("subscribe avisa en la misma pestaña al persistir", async () => {
  const store = createAdminDesignStore(memoryBackend());
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });
  await store.saveNew({
    name: "N",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero",
  });
  expect(calls).toBe(1);
  stop();
  await store.saveNew({
    name: "M",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero",
  });
  expect(calls).toBe(1);
});

// ---- Corrección verificador: paths corruptos a nivel runtime no lanzan ----

test("checkDesignGeometry no lanza con entradas runtime inválidas", () => {
  const badInputs: unknown[] = [
    [null],
    [undefined],
    ["M0 0"],
    [42],
    [["M0 0"]],
    [{}],
    [{ d: 42 }],
    [{ d: null }],
    [{ d: "M10 10H90V90H10Z", transform: 42 }],
    [{ d: "M10 10H90V90H10Z", transform: {} }],
    [{ d: "M10 10H90V90H10Z", transform: null }],
  ];
  for (const paths of badInputs) {
    let result: ReturnType<typeof checkDesignGeometry> | undefined;
    let threw = false;
    try {
      result = checkDesignGeometry(paths as never);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result!.ok).toBe(false);
  }
});

test("parseEnvelope aísla paths corruptos y conserva vecinos válidos", () => {
  const goodBefore = storedSquare("vecino-antes");
  const goodAfter = storedSquare("vecino-despues");
  const corruptNull = {
    ...validDesign({ id: "roto-null" }),
    paths: [null] as never,
  };
  const corruptString = {
    ...validDesign({ id: "roto-string" }),
    paths: ["M0 0"] as never,
  };
  const corruptNumber = {
    ...validDesign({ id: "roto-numero" }),
    paths: [42] as never,
  };
  const corruptArray = {
    ...validDesign({ id: "roto-arreglo" }),
    paths: [["M0 0"]] as never,
  };
  const corruptMissingD = {
    ...validDesign({ id: "roto-sin-d" }),
    paths: [{}] as never,
  };
  const corruptTransform = {
    ...validDesign({ id: "roto-transform" }),
    paths: [{ d: "M10 10H90V90H10Z", transform: 42 }] as never,
  };
  let parsed: ReturnType<typeof parseEnvelope> | undefined;
  let threw = false;
  try {
    parsed = parseEnvelope(
      envelope([
        goodBefore,
        corruptNull,
        corruptString,
        corruptNumber,
        corruptArray,
        corruptMissingD,
        corruptTransform,
        goodAfter,
      ]),
    );
  } catch {
    threw = true;
  }
  expect(threw).toBe(false);
  expect(parsed!.designs.map((design) => design.id)).toEqual([
    "vecino-antes",
    "vecino-despues",
  ]);
  expect(parsed!.corrupted).toBe(true);
  expect(parsed!.skipped.length).toBe(6);
  for (const skipped of parsed!.skipped)
    expect(skipped.reason.length).toBeGreaterThan(0);
});

test("load no rechaza con paths corruptos: blob intacto y escritura bloqueada", async () => {
  const raw = envelope([
    storedSquare("ok-vecino"),
    { ...validDesign({ id: "roto-null" }), paths: [null] as never },
  ]);
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
  const store = createAdminDesignStore(backend);
  let loaded: Awaited<ReturnType<typeof store.load>> | undefined;
  let threw = false;
  try {
    loaded = await store.load();
  } catch {
    threw = true;
  }
  expect(threw).toBe(false);
  expect(loaded!.designs.map((design) => design.id)).toEqual(["ok-vecino"]);
  expect(loaded!.corrupted).toBe(true);
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
  const attempt = await store.saveNew({
    name: "N",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero",
  });
  expect(attempt.ok).toBe(false);
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
});

// ---- Modelo v3: asset SVG sanitizado, compatibilidad v1/v2/v3 ----
//
// v3 necesita DOMParser/XMLSerializer (sanitizeStoredSvgAsset), ausentes en
// el runner Node de Playwright: los casos que aceptan v3 válido corren en
// navegador vía page.evaluate (mismo patrón que admin-lab-svg-asset.spec.ts).
// Los rechazos por clave cruda o versión desconocida son observables en Node.

const V3_SOURCE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
  '<path d="M0 0H10V10Z" fill="red"/></svg>';

test("FORBIDDEN_RAW_KEYS sigue rechazando svg/markup/raw en v1 y v2", () => {
  const candidates: unknown[] = [
    { ...validDesign(), svg: "<svg/>" },
    { ...validDesign(), markup: "<svg/>" },
    { ...validDesign(), raw: "<svg/>" },
    { ...v2Design(), svg: "<svg/>" },
    { ...v2Design(), markup: "<svg/>" },
    { ...v2Design(), rawSvg: "<svg/>" },
    { ...v2Design(), href: "https://evil.example/x" },
  ];
  for (const candidate of candidates) {
    const checked = validateStoredDesign(candidate);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.reason).toMatch(/sin procesar/);
  }
  // v3 admite SOLO la clave svg (vía revalidación); el resto sigue vetado.
  for (const extra of ["markup", "rawSvg", "raw", "xml", "html"]) {
    const checked = validateStoredDesign({
      version: 3,
      id: "v3-raw",
      name: "N",
      category: "C",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      svg: "<svg/>",
      width: null,
      height: null,
      viewBox: null,
      [extra]: "x",
    });
    expect(checked.ok).toBe(false);
  }
});

test("versión 4 desconocida queda aislada en solo lectura sin reescribir", async () => {
  const raw = envelope([
    validDesign({ id: "known" }),
    { ...v2Design("future"), version: 4 },
  ]);
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
  const store = createAdminDesignStore(backend);
  const loaded = await store.load();
  expect(loaded.designs.map((d) => d.id)).toEqual(["known"]);
  expect(loaded.corrupted).toBe(true);
  expect((await store.updateDesign("known", { name: "X" })).ok).toBe(false);
  expect((await store.toggleDesign("known")).ok).toBe(false);
  expect((await store.removeDesign("known")).ok).toBe(false);
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
});

test("v3 se guarda y recarga con forma canónica estable y derivados intactos", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const imported = assets.importSvgAsset(source);
    if (!imported.ok)
      return { stage: "import-failed", reason: imported.reason };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Afiche",
      category: "Arte",
      asset: imported.asset,
    });
    if (!saved.ok) return { stage: "save-failed" };
    const persisted = JSON.parse(data.get(repo.ADMIN_LAB_STORAGE_KEY)!);
    const loaded = await store.load();
    const roundtrip = loaded.designs[0] as unknown as Record<string, unknown>;
    return {
      stage: "done",
      savedVersion: (saved.design as unknown as { version: unknown }).version,
      envelopeVersion: persisted.version,
      recordVersion: persisted.records[0].version,
      svgEqual: roundtrip.svg === imported.asset.svg,
      width: roundtrip.width,
      height: roundtrip.height,
      viewBox: roundtrip.viewBox,
      expectedWidth: imported.asset.width,
      expectedHeight: imported.asset.height,
      expectedViewBox: imported.asset.viewBox,
      count: loaded.designs.length,
      corrupted: loaded.corrupted,
    };
  }, V3_SOURCE);
  expect(result.stage).toBe("done");
  if (result.stage !== "done") return;
  expect(result.savedVersion).toBe(3);
  expect(result.envelopeVersion).toBe(1);
  expect(result.recordVersion).toBe(3);
  expect(result.svgEqual).toBe(true);
  expect(result.width).toBe(result.expectedWidth);
  expect(result.height).toBe(result.expectedHeight);
  expect(result.viewBox).toEqual(result.expectedViewBox);
  expect(result.width).toBe(100);
  expect(result.height).toBe(50);
  expect(result.count).toBe(1);
  expect(result.corrupted).toBe(false);
});

test("v1, v2 y v3 conviven: todos cargan y ninguno se reescribe al leer", async ({
  page,
}) => {
  const records = [validDesign({ id: "convive-v1" }), v2Design("convive-v2")];
  await page.goto("/admin-lab");
  const result = await page.evaluate(
    async ({ source, seed }: { source: string; seed: unknown[] }) => {
      const repo = await import(
        /* @vite-ignore */ "/src/admin-lab/repository.ts"
      );
      const assets = await import(
        /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
      );
      const data = new Map<string, string>();
      const backend = {
        getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      };
      const imported = assets.importSvgAsset(source);
      if (!imported.ok) return { stage: "import-failed" };
      const v3 = {
        version: 3,
        id: "convive-v3",
        name: "Afiche",
        category: "Arte",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        svg: imported.asset.svg,
        width: imported.asset.width,
        height: imported.asset.height,
        viewBox: { ...imported.asset.viewBox! },
      };
      const raw = JSON.stringify({ version: 1, records: [...seed, v3] });
      data.set(repo.ADMIN_LAB_STORAGE_KEY, raw);
      const store = repo.createAdminDesignStore(backend);
      const loaded = await store.load();
      const found = loaded.designs.find((d) => d.id === "convive-v3") as
        unknown | undefined;
      return {
        stage: "done",
        ids: loaded.designs.map((d) => d.id),
        versions: loaded.designs.map((d) => d.version),
        rawSame: data.get(repo.ADMIN_LAB_STORAGE_KEY) === raw,
        corrupted: loaded.corrupted,
        svgEqual:
          (found as { svg?: unknown } | undefined)?.svg === imported.asset.svg,
      };
    },
    { source: V3_SOURCE, seed: records },
  );
  expect(result.stage).toBe("done");
  if (result.stage !== "done") return;
  expect(result.ids).toEqual(["convive-v1", "convive-v2", "convive-v3"]);
  expect(result.versions).toEqual([1, 2, 3]);
  expect(result.rawSame).toBe(true);
  expect(result.corrupted).toBe(false);
  expect(result.svgEqual).toBe(true);
});

test("v3 con cuerpo re-sanitizable se acepta canónico y sigue editable", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return [];
    const base = {
      version: 3,
      id: "hostil",
      name: "Hostil",
      category: "Arte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      width: imported.asset.width,
      height: imported.asset.height,
      viewBox: { ...imported.asset.viewBox! },
    };
    const good = {
      version: 1,
      id: "vecino",
      name: "Guarda",
      category: "Guardas",
      paths: [{ d: "M10 10H90V90H10Z" }],
      artBounds: { x: 10, y: 10, width: 80, height: 80 },
      fillRule: "nonzero",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    // Matriz nueva: el cuerpo re-sanitizable se purga y el archivo se
    // acepta con su forma canónica; solo lo no-string sigue aislado.
    const cases: Array<{ name: string; record: unknown; trace: string }> = [
      {
        name: "script",
        record: {
          ...base,
          svg: imported.asset.svg.replace(
            "<path",
            "<script>alert(1)</script><path",
          ),
        },
        trace: "alert",
      },
      {
        name: "onload",
        record: {
          ...base,
          svg: imported.asset.svg.replace("<path", '<path onload="alert(1)"'),
        },
        trace: "onload",
      },
      {
        name: "external-href",
        record: {
          ...base,
          svg: imported.asset.svg.replace(
            "</svg>",
            '<image href="https://evil.example/x.png" x="0" y="0" width="10" height="10"/></svg>',
          ),
        },
        trace: "evil.example",
      },
    ];
    const outcomes = [];
    for (const hostile of cases) {
      const raw = JSON.stringify({
        version: 1,
        records: [good, hostile.record],
      });
      data.set(repo.ADMIN_LAB_STORAGE_KEY, raw);
      const store = repo.createAdminDesignStore(backend);
      const loaded = await store.load();
      const found = loaded.designs.find((d) => d.id === "hostil") as
        unknown | undefined;
      // La lectura nunca reescribe: el blob sigue intacto aquí.
      const rawSameAtLoad = data.get(repo.ADMIN_LAB_STORAGE_KEY) === raw;
      const toggled = await store.toggleDesign("hostil");
      outcomes.push({
        name: hostile.name,
        ids: loaded.designs.map((d) => d.id),
        corrupted: loaded.corrupted,
        damaged: loaded.damaged,
        canonical:
          (found as { svg?: unknown } | undefined)?.svg === imported.asset.svg,
        traceGone: !JSON.stringify(found ?? {}).includes(hostile.trace),
        toggleOk: toggled.ok,
        rawSame: rawSameAtLoad,
      });
    }
    return outcomes;
  }, V3_SOURCE);
  expect(result.length).toBe(3);
  for (const outcome of result) {
    expect(outcome.ids).toEqual(["vecino", "hostil"]);
    expect(outcome.corrupted).toBe(false);
    expect(outcome.damaged).toBe(false);
    expect(outcome.canonical).toBe(true);
    expect(outcome.traceGone).toBe(true);
    expect(outcome.toggleOk).toBe(true);
    expect(outcome.rawSame).toBe(true);
  }
});

test("v3 no-string se aísla en solo lectura: sobre intacto, sin escritura ni borrado", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return null;
    const good = {
      version: 1,
      id: "vecino",
      name: "Guarda",
      category: "Guardas",
      paths: [{ d: "M10 10H90V90H10Z" }],
      artBounds: { x: 10, y: 10, width: 80, height: 80 },
      fillRule: "nonzero",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const hostile = {
      version: 3,
      id: "hostil",
      name: "Hostil",
      category: "Arte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      width: imported.asset.width,
      height: imported.asset.height,
      viewBox: { ...imported.asset.viewBox! },
      svg: 42,
    };
    const raw = JSON.stringify({ version: 1, records: [good, hostile] });
    data.set(repo.ADMIN_LAB_STORAGE_KEY, raw);
    const store = repo.createAdminDesignStore(backend);
    const loaded = await store.load();
    const attempts = [
      await store.saveNew({
        name: "N",
        category: "C",
        paths: [{ d: "M10 10H90V90H10Z" }],
        artBounds: { x: 10, y: 10, width: 80, height: 80 },
        fillRule: "nonzero" as const,
      }),
      await store.updateDesign("vecino", { name: "X" }),
      await store.toggleDesign("vecino"),
      await store.removeDesign("vecino"),
    ];
    return {
      ids: loaded.designs.map((d) => d.id),
      skipped: loaded.skipped.map((s) => s.reason),
      corrupted: loaded.corrupted,
      damaged: loaded.damaged,
      allBlocked: attempts.every((a) => !a.ok),
      rawSame: data.get(repo.ADMIN_LAB_STORAGE_KEY) === raw,
    };
  }, V3_SOURCE);
  expect(result).not.toBeNull();
  expect(result!.ids).toEqual(["vecino"]);
  expect(result!.skipped).toHaveLength(1);
  expect(result!.skipped[0]).toMatch(/revalidaci/);
  expect(result!.corrupted).toBe(true);
  expect(result!.damaged).toBe(true);
  expect(result!.allBlocked).toBe(true);
  expect(result!.rawSame).toBe(true);
});

test("v3 con bytes no canónicos se acepta canónico; derivados desync se aíslan", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return [];
    const base = {
      version: 3,
      id: "tocado",
      name: "Tocado",
      category: "Arte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      width: imported.asset.width,
      height: imported.asset.height,
      viewBox: { ...imported.asset.viewBox! },
    };
    // Matriz nueva: lo que re-sanitiza limpio se acepta con su forma
    // canónica; la desincronización de derivados sigue aislada.
    const cases: Array<{ name: string; record: unknown }> = [
      // Espacio fuera de la raíz: el sanitizador lo normaliza.
      {
        name: "bytes",
        record: { ...base, svg: imported.asset.svg + "\n " },
      },
      // viewBox del documento ya no coincide con el derivado declarado.
      {
        name: "viewbox",
        record: {
          ...base,
          svg: imported.asset.svg.replace(
            'viewBox="0 0 100 50"',
            'viewBox="0 0 200 50"',
          ),
        },
      },
      // Ancho declarado inflado respecto del derivado real.
      { name: "width", record: { ...base, width: 999 } },
    ];
    const outcomes = [];
    for (const tampered of cases) {
      const raw = JSON.stringify({ version: 1, records: [tampered.record] });
      data.set(repo.ADMIN_LAB_STORAGE_KEY, raw);
      const store = repo.createAdminDesignStore(backend);
      const loaded = await store.load();
      const found = loaded.designs.find((d) => d.id === "tocado") as
        unknown | undefined;
      // La lectura nunca reescribe: el blob sigue intacto aquí (el toggle
      // válido posterior sí persiste la forma canónica).
      const rawSameAtLoad = data.get(repo.ADMIN_LAB_STORAGE_KEY) === raw;
      const blocked = await store.toggleDesign("tocado");
      outcomes.push({
        name: tampered.name,
        ids: loaded.designs.map((d) => d.id),
        skipped: loaded.skipped.map((s) => s.reason),
        corrupted: loaded.corrupted,
        damaged: loaded.damaged,
        canonical:
          (found as { svg?: unknown } | undefined)?.svg === imported.asset.svg,
        blocked: !blocked.ok,
        rawSame: rawSameAtLoad,
      });
    }
    return outcomes;
  }, V3_SOURCE);
  expect(result.length).toBe(3);
  const byName = Object.fromEntries(result.map((o) => [o.name, o]));
  // Bytes no canónicos pero re-sanitizables: válidos con forma canónica.
  expect(byName.bytes.ids).toEqual(["tocado"]);
  expect(byName.bytes.skipped).toHaveLength(0);
  expect(byName.bytes.corrupted).toBe(false);
  expect(byName.bytes.damaged).toBe(false);
  expect(byName.bytes.canonical).toBe(true);
  expect(byName.bytes.blocked).toBe(false);
  expect(byName.bytes.rawSame).toBe(true);
  // Derivados desincronizados: aislados, blob intacto, escritura bloqueada.
  for (const name of ["viewbox", "width"]) {
    expect(byName[name].ids).toEqual([]);
    expect(byName[name].skipped).toHaveLength(1);
    expect(byName[name].skipped[0]).toMatch(/revalidaci/);
    expect(byName[name].corrupted).toBe(true);
    expect(byName[name].damaged).toBe(true);
    expect(byName[name].blocked).toBe(true);
    expect(byName[name].rawSame).toBe(true);
  }
});

test("alcance por versión: mismo svg se rechaza en v1 y se acepta en v3", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return { stage: "import-failed" };
    const metadata = {
      name: "Mismo",
      category: "Arte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const raw = JSON.stringify({
      version: 1,
      records: [
        {
          version: 1,
          id: "v1-con-svg",
          ...metadata,
          paths: [{ d: "M10 10H90V90H10Z" }],
          artBounds: { x: 10, y: 10, width: 80, height: 80 },
          fillRule: "nonzero",
          svg: imported.asset.svg,
        },
        {
          version: 3,
          id: "v3-con-svg",
          ...metadata,
          svg: imported.asset.svg,
          width: imported.asset.width,
          height: imported.asset.height,
          viewBox: { ...imported.asset.viewBox! },
        },
      ],
    });
    data.set(repo.ADMIN_LAB_STORAGE_KEY, raw);
    const loaded = await repo.createAdminDesignStore(backend).load();
    return {
      stage: "done",
      ids: loaded.designs.map((d) => d.id),
      reasons: loaded.skipped.map((s) => s.reason),
      rawSame: data.get(repo.ADMIN_LAB_STORAGE_KEY) === raw,
    };
  }, V3_SOURCE);
  expect(result.stage).toBe("done");
  if (result.stage !== "done") return;
  expect(result.ids).toEqual(["v3-con-svg"]);
  expect(result.reasons).toHaveLength(1);
  expect(result.reasons[0]).toMatch(/sin procesar/);
  expect(result.rawSame).toBe(true);
});

test("alta nueva produce versión 3 y sus mutaciones reescriben v3", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return { stage: "import-failed" };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Afiche",
      category: "Arte",
      asset: imported.asset,
    });
    if (!saved.ok) return { stage: "save-failed" };
    const id = (saved.design as unknown as { id: string }).id;
    const renamed = await store.updateDesign(id, { name: "Afiche fino" });
    if (!renamed.ok) return { stage: "rename-failed" };
    const toggled = await store.toggleDesign(id);
    if (!toggled.ok) return { stage: "toggle-failed" };
    const persisted = JSON.parse(data.get(repo.ADMIN_LAB_STORAGE_KEY)!);
    const record = persisted.records[0];
    const reloaded = await store.load();
    const found = reloaded.designs[0] as unknown as Record<string, unknown>;
    return {
      stage: "done",
      savedVersion: (saved.design as unknown as { version: unknown }).version,
      envelopeVersion: persisted.version,
      recordVersion: record.version,
      svgEqual:
        record.svg === imported.asset.svg && found.svg === imported.asset.svg,
      name: record.name,
      enabled: record.enabled,
      count: reloaded.designs.length,
    };
  }, V3_SOURCE);
  expect(result.stage).toBe("done");
  if (result.stage !== "done") return;
  expect(result.savedVersion).toBe(3);
  expect(result.envelopeVersion).toBe(1);
  expect(result.recordVersion).toBe(3);
  expect(result.svgEqual).toBe(true);
  expect(result.name).toBe("Afiche fino");
  expect(result.enabled).toBe(false);
  expect(result.count).toBe(1);
});

// ---- Segunda ronda: F5 (sensibilidad a prototipo) ----

test("F5: versión y asset heredados no valen; __proto__ no rompe ni otorga v3", () => {
  // Solo heredado version:3/svg (sin versión propia) → inválido.
  const inherited = Object.create({
    version: 3,
    svg: V3_SOURCE,
    width: 100,
    height: 50,
    viewBox: { x: 0, y: 0, width: 100, height: 50 },
  });
  Object.assign(inherited, {
    id: "heredado",
    name: "N",
    category: "C",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  expect(validateStoredDesign(inherited).ok).toBe(false);

  // v1 propio + svg/markup heredados → v1 válido, lo heredado se ignora.
  const v1rec = Object.create({ svg: "<svg/>", markup: "<svg/>" });
  Object.assign(v1rec, validDesign({ id: "v1-heredado" }));
  const checkedV1 = validateStoredDesign(v1rec);
  expect(checkedV1.ok).toBe(true);
  if (checkedV1.ok) {
    expect(checkedV1.design.version).toBe(1);
    expect("svg" in checkedV1.design).toBe(false);
  }

  // Claves __proto__ en JSON: propias e inertes, no rompen ni otorgan v3.
  const raw =
    '{"version":1,"records":[{"version":1,"id":"p","name":"N",' +
    '"category":"C","paths":[{"d":"M10 10H90V90H10Z"}],' +
    '"artBounds":{"x":10,"y":10,"width":80,"height":80},' +
    '"fillRule":"nonzero","enabled":true,' +
    '"createdAt":"2026-01-01T00:00:00.000Z",' +
    '"__proto__":{"version":3,"svg":"<svg/>"}}],' +
    '"__proto__":{"version":3}}';
  const parsed = parseEnvelope(raw);
  expect(parsed.designs.map((d) => d.id)).toEqual(["p"]);
  expect(parsed.designs[0].version).toBe(1);
  expect(parsed.corrupted).toBe(false);
  expect(parsed.damaged).toBe(false);
});

// ---- Segunda ronda: A4 (constante + costo de trabajo v3) ----

test("A4: MODEL_VERSION_ASSET es la versión vigente, sin literales a la deriva", () => {
  expect(MODEL_VERSION_ASSET).toBe(DESIGN_MODEL_VERSION);
  expect(MODEL_VERSION_ASSET).toBe(3);
});

test("A4: una biblioteca pesada en v3 aporta trabajo medible al tope agregado", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return null;
    // Relleno que el sanitizador purga (comentario): cada registro valida
    // canónico pero el escaneo cobra el largo crudo completo.
    const pad = `<!-- ${"p".repeat(120_000)} -->`;
    const svg = imported.asset.svg.replace("</svg>", `${pad}</svg>`);
    const records = Array.from({ length: 25 }, (_, i) => ({
      version: 3,
      id: `pesado-${i}`,
      name: `Pesado ${i}`,
      category: "Arte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      svg,
      width: imported.asset.width,
      height: imported.asset.height,
      viewBox: { ...imported.asset.viewBox! },
    }));
    const parsed = repo.parseEnvelope(JSON.stringify({ version: 1, records }));
    return {
      count: parsed.designs.length,
      corrupted: parsed.corrupted,
      damaged: parsed.damaged,
      firstSkip: parsed.skipped[0]?.reason ?? null,
    };
  }, V3_SOURCE);
  expect(result).not.toBeNull();
  expect(result!.corrupted).toBe(true);
  expect(result!.damaged).toBe(false);
  expect(result!.count).toBeLessThan(25);
  expect(result!.count).toBeGreaterThan(0);
  expect(result!.firstSkip).toMatch(/trabajo acumulado/);
});

// ---- Segunda ronda: R3 (daño genuino vs. saltos de presupuesto) ----

test("R3: biblioteca de 201 registros puede borrar; el alta sigue bloqueada hasta limpiar", async () => {
  const raw = JSON.stringify({
    version: 1,
    records: Array.from({ length: 201 }, (_, i) => storedSquare(`d-${i}`)),
  });
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
  const store = createAdminDesignStore(backend);
  const loaded = await store.load();
  expect(loaded.designs).toHaveLength(200);
  expect(loaded.corrupted).toBe(true);
  expect(loaded.damaged).toBe(false);
  const input = {
    name: "Uno más",
    category: "C",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero" as const,
  };
  expect((await store.saveNew(input)).ok).toBe(false);
  expect(backend.getItem(ADMIN_LAB_STORAGE_KEY)).toBe(raw);
  const removed = await store.removeDesign("d-0");
  expect(removed.ok).toBe(true);
  const clean = await store.load();
  expect(clean.designs).toHaveLength(199);
  expect(clean.corrupted).toBe(false);
  expect(clean.damaged).toBe(false);
  expect((await store.saveNew(input)).ok).toBe(true);
  expect((await store.load()).designs).toHaveLength(200);
});

test("R3: biblioteca con id duplicado puede borrar y quedar limpia", async () => {
  const raw = envelope([
    validDesign({ id: "dup" }),
    validDesign({ id: "dup", name: "Otra" }),
  ]);
  const backend = memoryBackend({ [ADMIN_LAB_STORAGE_KEY]: raw });
  const store = createAdminDesignStore(backend);
  const loaded = await store.load();
  expect(loaded.designs.map((d) => d.id)).toEqual(["dup"]);
  expect(loaded.corrupted).toBe(true);
  expect(loaded.damaged).toBe(false);
  // Borrar por el id duplicado elimina el conservado y suelta al gemelo
  // omitido: la reescritura solo persiste lo listado (acción explícita).
  expect((await store.removeDesign("dup")).ok).toBe(true);
  const clean = await store.load();
  expect(clean.designs).toEqual([]);
  expect(clean.corrupted).toBe(false);
});

// ---- Segunda ronda: R6 (cuota en alta v3) ----

test("R6: cuota agotada en alta v3 no afirma guardado y deja la biblioteca intacta", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return null;
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Afiche",
      category: "Arte",
      asset: imported.asset,
    });
    const loaded = await store.load();
    return {
      ok: saved.ok,
      code: saved.ok ? null : saved.error.code,
      count: loaded.designs.length,
      storedKeys: [...data.keys()],
    };
  }, V3_SOURCE);
  expect(result).not.toBeNull();
  expect(result!.ok).toBe(false);
  expect(result!.code).toBe("STORAGE_QUOTA");
  expect(result!.count).toBe(0);
  expect(result!.storedKeys).toEqual([]);
});

// ---- Segunda ronda: la mutación v3 persiste la forma canónica ----

test("mutación de metadatos v3 persiste la forma canónica re-sanitizada", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (source) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return null;
    // Cuerpo re-sanitizable a forma menor: comentario purgable.
    const storedSvg = imported.asset.svg.replace(
      "</svg>",
      "<!-- nota de editor --></svg>",
    );
    if (storedSvg === imported.asset.svg) return null;
    data.set(
      repo.ADMIN_LAB_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        records: [
          {
            version: 3,
            id: "afiche",
            name: "Afiche",
            category: "Arte",
            enabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            svg: storedSvg,
            width: imported.asset.width,
            height: imported.asset.height,
            viewBox: { ...imported.asset.viewBox! },
          },
        ],
      }),
    );
    const store = repo.createAdminDesignStore(backend);
    const loaded = await store.load();
    if (loaded.designs.length !== 1 || loaded.corrupted) return null;
    const renamed = await store.updateDesign("afiche", {
      name: "Afiche fino",
    });
    if (!renamed.ok) return null;
    const persisted = JSON.parse(data.get(repo.ADMIN_LAB_STORAGE_KEY)!)
      .records[0];
    return {
      persistedSvg: persisted.svg as string,
      canonicalSvg: imported.asset.svg,
      name: persisted.name as string,
    };
  }, V3_SOURCE);
  expect(result).not.toBeNull();
  expect(result!.persistedSvg).toBe(result!.canonicalSvg);
  expect(result!.persistedSvg).not.toContain("nota de editor");
  expect(result!.name).toBe("Afiche fino");
});
