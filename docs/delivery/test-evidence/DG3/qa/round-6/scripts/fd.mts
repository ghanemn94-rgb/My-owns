const m = await import(process.cwd() + "/src/value.ts");
for (const v of ["abc", "", " ", "1e5", "NaN", "Infinity", "0x10", "1,000", "--1", "12.345678901", "100000", "0", "-0.5", null, undefined, {toString(){throw new TypeError("x")}} as any]) {
  let out; try { out = JSON.stringify(m.formatDecimal(v, { locale: "en" })); } catch (e) { out = "THROW " + (e as Error).name; }
  let ar; try { ar = JSON.stringify(m.formatDecimal(v, { locale: "ar" })); } catch (e) { ar = "THROW " + (e as Error).name; }
  console.log(JSON.stringify(typeof v === "object" && v ? "<hostile toString TypeError>" : v), "en:", out, "ar:", ar);
}
