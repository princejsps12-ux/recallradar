import React, { useEffect, useRef, useState } from 'react';
import { invoke, router } from '@forge/bridge';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import Button from '@atlaskit/button/new';
import Textarea from '@atlaskit/textarea';
import Select from '@atlaskit/select';
import SectionMessage from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import { sp, muted } from '../ui/kit';
import { affectedMatches } from '../dashboardData.mjs';

const EXAMPLE = 'Name\tManufacturer\tModel\tSerial\tWard\nSigma Spectrum pump\tBaxter Healthcare\t35700BAX2\tSP-30977\tMed-Surg 4E';

// Paste rows from a spreadsheet; the first row names the columns. All or nothing: a bad row is listed and
// nothing is imported.
export function ImportModal({ isOpen, onClose, onImported }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [removeAsk, setRemoveAsk] = useState(''); // '' | 'imported' | 'all'
  const [done, setDone] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const submit = async () => {
    setBusy(true);
    setProblems([]);
    setDone('');
    try {
      const r = await invoke('importDevices', { text });
      if (r && r.ok) {
        setText('');
        onImported(r.count);
        onClose();
      } else if (mounted.current) setProblems((r && r.errors) || ['Could not import the devices.']);
    } catch (e) {
      if (mounted.current) setProblems(['Could not reach RecallRadar. Check your connection and try again.']);
    }
    if (mounted.current) setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await invoke(removeAsk === 'all' ? 'clearDevices' : 'removeImportedDevices');
      if (r && r.ok) {
        setDone(removeAsk === 'all' ? 'Removed all devices.' : 'Removed the devices you imported.');
        setRemoveAsk('');
        onImported(r.count);
      } else setProblems([(r && r.error) || 'Could not remove them.']);
    } catch (e) {
      setProblems(['Could not reach RecallRadar.']);
    }
    if (mounted.current) setBusy(false);
  };

  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={onClose} width="medium" label="Import your own devices">
          <ModalHeader hasCloseButton><ModalTitle>Import your own devices</ModalTitle></ModalHeader>
          <ModalBody>
            <p style={{ marginTop: 0, marginBottom: sp(200) }}>Copy rows from a spreadsheet (or a .csv) and paste them here. The first row names the columns: <strong>Manufacturer</strong> and <strong>Model</strong> are required; Name, Type, Serial (or Lot) and Ward are optional. Up to 200 devices at a time. Importing replaces the devices you imported before and leaves the demo hospital alone. <strong>Do not include patient data.</strong></p>
            <Textarea aria-label="Devices to import" placeholder={EXAMPLE} minimumRows={8} resize="vertical" value={text} onChange={(e) => setText(e.target.value)} />
            <div role="status" aria-live="polite" style={{ marginTop: sp(100), minHeight: '72px' }}>
              {problems.length > 0 && (
                <SectionMessage appearance="error" title="Nothing was imported">
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </SectionMessage>
              )}
              {done && <SectionMessage appearance="success">{done}</SectionMessage>}
            </div>
          </ModalBody>
          <ModalFooter>
            {removeAsk ? (
              <>
                <span style={{ marginRight: 'auto' }}>{removeAsk === 'all' ? 'Remove ALL devices, including the demo hospital?' : 'Remove all devices you imported?'}</span>
                <Button appearance="danger" isDisabled={busy} onClick={remove}>Yes, remove them</Button>
                <Button appearance="subtle" onClick={() => setRemoveAsk('')}>Keep them</Button>
              </>
            ) : (
              <>
                <Button appearance="subtle" isDisabled={busy} onClick={() => setRemoveAsk('imported')}>Remove imported devices</Button>
                <Button appearance="subtle" isDisabled={busy} onClick={() => setRemoveAsk('all')}>Remove all devices</Button>
                <span style={{ marginRight: 'auto' }} />
                <Button appearance="subtle" onClick={onClose}>Cancel</Button>
                <Button appearance="primary" isLoading={busy} isDisabled={!text.trim()} onClick={submit}>Import devices</Button>
              </>
            )}
          </ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}

// One Confluence page per open recall (what is wrong, what to do, affected devices, task links), or an update of
// the page that is already there. The pages list device ids and wards, so the person chooses the space.
export function ConfluenceModal({ isOpen, onClose, result }) {
  const [spaces, setSpaces] = useState(null);
  const [error, setError] = useState('');
  const [space, setSpace] = useState(null);
  const [recall, setRecall] = useState({ label: 'All open recalls', value: '' });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    if (!isOpen || spaces !== null) return;
    invoke('listSpaces')
      .then((r) => (r && r.ok ? setSpaces(r.spaces) : setError((r && r.error) || 'Could not read Confluence spaces.')))
      .catch(() => setError('Could not reach RecallRadar.'));
  }, [isOpen, spaces]);

  const open = [...new Set(affectedMatches(result).map((m) => m.recallNumber))];
  const recallOptions = [{ label: `All open recalls (${open.length})`, value: '' }, ...open.map((n) => ({ label: n, value: n }))];
  const spaceOptions = (spaces || []).map((s) => ({ label: `${s.name} (${s.key})`, value: s.key }));

  const create = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await invoke('createRecallPage', { spaceKey: space.value, recallNumber: recall.value });
      if (r && r.ok && r.state === 'done') setOutcome({ kind: 'success', pages: r.pages, failed: r.failed, more: r.notIncluded, space: r.space.name });
      else setOutcome({ kind: 'error', text: (r && (r.message || r.error)) || 'Could not create the page.' });
    } catch (e) {
      setOutcome({ kind: 'error', text: 'Could not reach RecallRadar.' });
    }
    setBusy(false);
  };

  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={onClose} width="medium" label="Create Confluence recall page">
          <ModalHeader hasCloseButton><ModalTitle>Create Confluence recall page</ModalTitle></ModalHeader>
          <ModalBody>
            <p style={{ marginTop: 0, marginBottom: sp(200) }}>One page per recall: what is wrong, what to do, the affected devices and links to their tasks. Running it again updates the page instead of making a second one. The pages list device ids and wards, so choose the space yourself.</p>
            {error && <SectionMessage appearance="error" title="Could not load spaces">{error}</SectionMessage>}
            {spaces === null && !error ? (
              <div style={{ display: 'flex', gap: sp(100), alignItems: 'center' }}><Spinner size="small" label="Loading spaces" /> Loading spaces…</div>
            ) : (
              <>
                <label style={muted} htmlFor="rr-space">Confluence space</label>
                <Select inputId="rr-space" aria-label="Confluence space" options={spaceOptions} value={space} onChange={setSpace} placeholder="Choose a space" menuPosition="fixed" />
                <div style={{ height: sp(150) }} />
                <label style={muted} htmlFor="rr-recall">Recall</label>
                <Select inputId="rr-recall" aria-label="Recall" options={recallOptions} value={recall} onChange={setRecall} menuPosition="fixed" />
              </>
            )}
            <div role="status" aria-live="polite" style={{ marginTop: sp(200) }}>
              {outcome && outcome.kind === 'error' && <SectionMessage appearance="error">{outcome.text}</SectionMessage>}
              {outcome && outcome.kind === 'success' && (
                <SectionMessage appearance="success" title={`Done in the ${outcome.space} space`}>
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    {outcome.pages.map((p) => (
                      <li key={p.recallNumber}>{p.recallNumber}: page {p.action}. <Button appearance="link" spacing="none" onClick={() => router.open(p.url)}>{p.title}</Button></li>
                    ))}
                  </ul>
                  {outcome.failed.length > 0 && <p>{outcome.failed.length} failed ({outcome.failed[0].error}).</p>}
                  {outcome.more > 0 && <p>{outcome.more} more recalls were not included: choose them one at a time.</p>}
                </SectionMessage>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" onClick={onClose}>Close</Button>
            <Button appearance="primary" isLoading={busy} isDisabled={!space} onClick={create}>Create page</Button>
          </ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}
