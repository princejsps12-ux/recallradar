import React, { useEffect, useRef, useState } from 'react';
import { invoke, router } from '@forge/bridge';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import Button from '@atlaskit/button/new';
import Textarea from '@atlaskit/textarea';
import Select from '@atlaskit/select';
import Checkbox from '@atlaskit/checkbox';
import { RadioGroup } from '@atlaskit/radio';
import SectionMessage from '@atlaskit/section-message';
import Spinner from '@atlaskit/spinner';
import { sp, color, muted, LinkLike } from '../ui/kit';
import { affectedMatches } from '../dashboardData.mjs';

const EXAMPLE = 'Name\tManufacturer\tModel\tSerial\tWard\nSigma Spectrum pump\tBaxter Healthcare\t35700BAX2\tSP-30977\tMed-Surg 4E';

// Paste rows from a spreadsheet; the first row names the columns. All or nothing: a bad row is listed and
// nothing is imported.
export function ImportModal({ isOpen, onClose, onImported, mode = 'import', importedCount = 0, total = 0 }) {
  const removing = mode === 'remove';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [removeAsk, setRemoveAsk] = useState(''); // '' | 'imported' | 'all'
  const [done, setDone] = useState('');
  // With nothing imported the only thing left to remove is everything, so that is the preselected choice.
  const defaultChoice = importedCount > 0 ? 'imported' : 'all';
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
        onImported({ imported: r.count });
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
      const r = await invoke((removeAsk || defaultChoice) === 'all' ? 'clearDevices' : 'removeImportedDevices');
      if (r && r.ok && mounted.current && removing) onClose();
      if (r && r.ok) {
        setDone((removeAsk || defaultChoice) === 'all' ? 'Removed all devices.' : 'Removed the devices you imported.');
        setRemoveAsk('');
        onImported({ removed: true, cleared: (removeAsk || defaultChoice) === 'all' });
      } else setProblems([(r && r.error) || 'Could not remove them.']);
    } catch (e) {
      setProblems(['Could not reach RecallRadar.']);
    }
    if (mounted.current) setBusy(false);
  };

  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={onClose} width="medium" label={removing ? 'Remove devices' : 'Import your own devices'}>
          <ModalHeader hasCloseButton><ModalTitle appearance={removing ? 'danger' : undefined}>{removing ? 'Remove devices' : 'Import your own devices'}</ModalTitle></ModalHeader>
          <ModalBody>
            {!removing && (<>
            <p style={{ marginTop: 0, marginBottom: sp(200) }}>Copy rows from a spreadsheet (or a .csv) and paste them here. The first row names the columns: <strong>Manufacturer</strong> and <strong>Model</strong> are required; Name, Type, Serial (or Lot) and Ward are optional. Up to 200 devices at a time. Importing replaces the devices you imported before and leaves the demo hospital alone. <strong>Do not include patient data.</strong></p>
            <Textarea isInvalid={problems.length > 0} aria-label="Devices to import" placeholder={EXAMPLE} minimumRows={8} resize="vertical" value={text} onChange={(e) => setText(e.target.value)} />
            </>)}
            <div role="status" aria-live="polite" style={{ marginTop: sp(100) }}>
              {problems.length > 0 && (
                <SectionMessage appearance="error" title="Nothing was imported">
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </SectionMessage>
              )}
              {done && <SectionMessage appearance="success">{done}</SectionMessage>}
            </div>
            {removing && (
              <>
                <p id="rr-remove-question" style={{ margin: `0 0 ${sp(100)}` }}>Removing devices cannot be undone. The saved recall result is rebuilt on the next check. Which devices do you want to remove?</p>
                <RadioGroup
                  name="rr-remove"
                  aria-labelledby="rr-remove-question"
                  value={removeAsk || defaultChoice}
                  onChange={(e) => setRemoveAsk(e.target.value)}
                  options={[
                    { name: 'rr-remove', value: 'imported', label: `Only the devices I imported (${importedCount})`, isDisabled: importedCount === 0 },
                    { name: 'rr-remove', value: 'all', label: `All devices, including the demo hospital (${total})` },
                  ]}
                />
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" onClick={onClose}>Cancel</Button>
            {removing && <Button appearance="danger" isLoading={busy} onClick={remove}>{(removeAsk || defaultChoice) === 'all' ? `Remove all ${total} devices` : `Remove ${importedCount} imported ${importedCount === 1 ? 'device' : 'devices'}`}</Button>}
            {!removing && <Button appearance="primary" isLoading={busy && !removeAsk} isDisabled={!text.trim()} onClick={submit}>Import devices</Button>}
          </ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}

// "Create all": one confirmation for every device and recall that still has no task, with the optional
// assignment (off by default). Tasks go in the project chosen on the dashboard.
export function CreateAllBody({ count, deviceCount, suggestedCount, projectName, assign, onAssign, running }) {
  const facts = [
    ['Devices without a task', deviceCount],
    ['Tasks', `${count} (one for each device and recall)`],
    ['Project', projectName],
  ];
  return (
    <>
      <p style={{ marginTop: 0, marginBottom: sp(200) }}>Each task has the ward, the reason the device matches, a link to the FDA recall and a due date from the recall class. A task is never created twice for the same device and recall.</p>
      <div role="group" aria-label="What will be created" style={{ border: `1px solid ${color.border}`, borderRadius: '8px', padding: sp(200), background: color.sunken, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: `${sp(100)} ${sp(300)}` }}>
        {facts.map(([label, value]) => (
          <React.Fragment key={label}>
            <span style={muted}>{label}</span>
            <strong>{value}</strong>
          </React.Fragment>
        ))}
      </div>
      {suggestedCount > 0 && (
        <div style={{ marginTop: sp(200) }}>
          <Checkbox label="Also assign the suggested team member" isChecked={assign} onChange={(e) => onAssign(e.target.checked)} />
          <div style={{ ...muted, marginLeft: sp(300) }}>{suggestedCount} of {count} tasks have a team in the Teamwork Graph; the work is spread across each ward's team. Nobody is assigned unless you tick this.</div>
        </div>
      )}
      <div role="status" aria-live="polite" style={{ marginTop: sp(150), minHeight: '24px' }}>
        {running && <span style={muted}>Creating tasks… this takes a moment.</span>}
      </div>
    </>
  );
}

export function CreateAllModal({ isOpen, onClose, count, deviceCount, suggestedCount, projectName, onConfirm, running }) {
  const [assign, setAssign] = useState(false);
  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={onClose} width="medium" label="Create all tasks">
          <ModalHeader hasCloseButton><ModalTitle>{`Create ${count} task${count === 1 ? '' : 's'}?`}</ModalTitle></ModalHeader>
          <ModalBody>
            <CreateAllBody count={count} deviceCount={deviceCount} suggestedCount={suggestedCount} projectName={projectName} assign={assign} onAssign={setAssign} running={running} />
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" isDisabled={running} onClick={onClose}>Cancel</Button>
            <Button appearance="primary" isLoading={running} onClick={() => onConfirm(assign)}>{`Create ${count}`}</Button>
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
  // Confluence is an optional connection of the app: a site that only installed it in Jira is the normal case, so this is
  // told as "connect it first, here is how" and not as a failure.
  const [notConnected, setNotConnected] = useState(false);
  const [space, setSpace] = useState(null);
  const [recall, setRecall] = useState({ label: 'All open recalls', value: '' });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    if (!isOpen || spaces !== null) return;
    invoke('listSpaces')
      .then((r) => {
        if (r && r.ok) {
          setSpaces(r.spaces);
          return;
        }
        setNotConnected(Boolean(r && r.notConnected));
        setError((r && r.error) || 'Could not read Confluence spaces.');
      })
      .catch(() => setError('Could not reach RecallRadar.'));
  }, [isOpen, spaces]);

  // One option per open recall, with its class and the first affected device, so a recall number is not all there is to go by.
  const byRecall = new Map();
  for (const m of affectedMatches(result)) {
    if (!byRecall.has(m.recallNumber)) byRecall.set(m.recallNumber, { cls: m.recallClass, devices: [] });
    const entry = byRecall.get(m.recallNumber);
    if (!entry.devices.includes(m.deviceName)) entry.devices.push(m.deviceName);
  }
  const open = [...byRecall.keys()];
  const MAX_PAGES_AT_ONCE = 10; // the same limit the server applies per request (MAX_PAGES_PER_CALL)
  const allLabel = open.length > MAX_PAGES_AT_ONCE ? `All open recalls (the first ${MAX_PAGES_AT_ONCE} of ${open.length}; choose the others one at a time)` : `All open recalls (${open.length})`;
  const recallOptions = [{ label: allLabel, value: '' }, ...open.map((n) => {
    const { cls, devices } = byRecall.get(n);
    return { label: `${n} · ${cls ? `Class ${cls}` : 'class not stated'} · ${devices[0]}${devices.length > 1 ? ` +${devices.length - 1}` : ''}`, value: n };
  })];
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
            {error && (
              <SectionMessage appearance={notConnected ? 'information' : 'error'} title={notConnected ? 'Connect RecallRadar to Confluence first' : 'Could not load spaces'}>
                {error}
              </SectionMessage>
            )}
            {error ? null : spaces === null ? (
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
                <SectionMessage appearance="success" title={`Done in ${outcome.space}`}>
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    {outcome.pages.map((p) => (
                      <li key={p.recallNumber}>{p.recallNumber}: page {p.action}. <LinkLike onClick={() => router.open(p.url)}>{p.title}</LinkLike></li>
                    ))}
                  </ul>
                  {outcome.failed.length > 0 && <p>{outcome.failed.length} failed ({outcome.failed[0].error}).</p>}
                  {outcome.more > 0 && <p>{outcome.more} more recalls were not included: choose them one at a time.</p>}
                </SectionMessage>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" onClick={onClose}>{outcome && outcome.kind === 'success' ? 'Close' : 'Cancel'}</Button>
            <Button appearance="primary" isLoading={busy} isDisabled={!space} onClick={create}>Create page</Button>
          </ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}
