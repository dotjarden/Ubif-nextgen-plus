/* MAIN-world adapter: print an inventory serial label with the Portal's own
 * Dymo framework, the same way its item details "Reprint Label" action does
 * (DefaultLabel template, TEXT = product name, BARCODE = serial, first
 * connected LabelWriter). The content script owns lookups and logging. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusLabelPage) return;
  globalThis.__ubifPlusLabelPage = true;
  // Copied from Portal's ubif-components.js LabelType.DefaultLabel (Oct 2026).
  const DEFAULT_LABEL = `<?xml version="1.0" encoding="utf-8"?>
  <DieCutLabel Version="8.0" Units="twips">
    <PaperOrientation>Landscape</PaperOrientation>
    <Id>ReturnAddress</Id>
    <PaperName>30330 Return Address</PaperName>
    <DrawCommands>
      <RoundRectangle X="0" Y="0" Width="1080" Height="2880" Rx="180" Ry="180" />
    </DrawCommands>
    <ObjectInfo>
      <TextObject>
        <Name>TEXT</Name>
        <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
        <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
        <LinkedObjectName></LinkedObjectName>
        <Rotation>Rotation0</Rotation>
        <IsMirrored>False</IsMirrored>
        <IsVariable>False</IsVariable>
        <HorizontalAlignment>Center</HorizontalAlignment>
        <VerticalAlignment>Top</VerticalAlignment>
        <TextFitMode>ShrinkToFit</TextFitMode>
        <UseFullFontHeight>True</UseFullFontHeight>
        <Verticalized>False</Verticalized>
        <StyledText>
          <Element>
            <String>Customer Name</String>
            <Attributes>
              <Font Family="Arial" Size="12" Bold="False" Italic="False" Underline="False" Strikeout="False" />
              <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
            </Attributes>
          </Element>
        </StyledText>
      </TextObject>
      <Bounds X="326" Y="80" Width="2217" Height="200" />
    </ObjectInfo>
    <ObjectInfo>
      <BarcodeObject>
        <Name>BARCODE</Name>
        <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
        <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
        <LinkedObjectName></LinkedObjectName>
        <Rotation>Rotation0</Rotation>
        <IsMirrored>False</IsMirrored>
        <IsVariable>True</IsVariable>
        <Text>1234567890123456</Text>
        <Type>Code128Auto</Type>
        <Size>Small</Size>
        <TextPosition>Bottom</TextPosition>
        <TextFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False" />
        <CheckSumFont Family="Arial" Size="8" Bold="False" Italic="False" Underline="False" Strikeout="False" />
        <TextEmbedding>None</TextEmbedding>
        <ECLevel>0</ECLevel>
        <HorizontalAlignment>Center</HorizontalAlignment>
        <QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0" />
      </BarcodeObject>
      <Bounds X="326" Y="378" Width="2247" Height="620" />
    </ObjectInfo>
  </DieCutLabel>`;
  const handled = new Set();
  addEventListener('message', event => {
    const m = event.data;
    if (event.source !== window || m?.source !== 'ubif-plus' || m.type !== 'label-print-request') return;
    if (typeof m.id !== 'string' || handled.has(m.id)) return;
    if (typeof m.serial !== 'string' || !m.serial.trim() || typeof m.text !== 'string' || !m.text.trim()) return;
    // Consume before printing: a label must never be printed twice for one click.
    handled.add(m.id);
    const reply = (state, message) => window.postMessage({ source: 'ubif-plus', type: 'label-print-result', id: m.id, state, message }, '*');
    const framework = window.dymo?.label?.framework;
    if (!framework?.openLabelXml || !framework.LabelSetBuilder) { reply('error', 'Portal’s label printer support is not loaded. Reload the page and try again.'); return; }
    try {
      // Portal uses the first LabelWriter only when it is connected.
      const printer = (framework.getLabelWriterPrinters?.() || [])[0];
      if (!printer?.isConnected || !printer.name) { reply('error', 'No label printer found. Check that the Dymo printer and DYMO Connect are running.'); return; }
      const label = framework.openLabelXml(DEFAULT_LABEL), records = new framework.LabelSetBuilder(), record = records.addRecord();
      record.setText('TEXT', m.text);
      record.setText('BARCODE', m.serial);
      label.print(printer.name, '', records.toString());
      reply('printed', `Label sent to ${printer.name}.`);
    } catch { reply('error', 'Portal could not print the label. Check the Dymo printer and try again.'); }
  });
})();
