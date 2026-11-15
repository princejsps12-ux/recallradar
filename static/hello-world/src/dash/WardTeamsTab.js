import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import DynamicTable from '@atlaskit/dynamic-table';
import Select from '@atlaskit/select';
import SectionMessage from '@atlaskit/section-message';
import VisuallyHidden from '@atlaskit/visually-hidden';
import { sp, muted, color } from '../ui/kit';
import Lozenge from '@atlaskit/lozenge';
import { affectedMatches } from '../dashboardData.mjs';

// Ward to team mapping: the team list is read from the Teamwork Graph (read-only) and the choice is saved
// in RecallRadar. Each change is saved at once and announced.
export default function WardTeamsTab({ wardInfo, onChanged, result }) {
  const [teams, setTeams] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    invoke('listTeams')
      .then((r) => {
        if (cancelled) return;
        if (r && r.ok) setTeams(r.teams);
        else setLoadError((r && r.error) || 'Could not read teams from the Teamwork Graph.');
      })
      .catch(() => !cancelled && setLoadError('Could not reach RecallRadar.'));
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async (ward, teamAri) => {
    setBusy(ward);
    setMessage(null);
    try {
      const r = await invoke('setWardTeam', { ward, teamAri });
      if (r && r.ok) {
        await onChanged();
        setMessage({ kind: 'success', text: r.removed ? `Removed the team for ${ward}.` : `${ward} is now handled by ${r.team.name}.` });
      } else {
        setMessage({ kind: 'error', text: (r && r.error) || 'Could not save.' });
      }
    } catch (e) {
      setMessage({ kind: 'error', text: 'Could not reach RecallRadar.' });
    }
    setBusy('');
  };

  const options = [{ label: 'No team', value: '' }, ...(teams || []).map((t) => ({ label: t.name, value: t.ari }))];

  // How many devices need action in each ward, and whether any has a Class I recall: wards with the most
  // urgent work come first, so those are the ones to map first.
  const needs = {};
  for (const m of result ? affectedMatches(result) : []) {
    const w = m.ward || 'No ward';
    needs[w] = needs[w] || { devices: new Set(), classI: false };
    needs[w].devices.add(m.deviceId);
    if (m.recallClass === 'I') needs[w].classI = true;
  }
  const count = (w) => (needs[w] ? needs[w].devices.size : 0);
  const classI = (w) => (needs[w] && needs[w].classI ? 1 : 0);
  const ordered = [...wardInfo.wards].sort((a, b) => classI(b) - classI(a) || count(b) - count(a) || a.localeCompare(b));
  const rows = ordered.map((ward) => {
    const mapping = wardInfo.byKey[String(ward).toLowerCase().replace(/[^a-z0-9]/g, '')];
    const value = mapping ? { label: mapping.teamName, value: mapping.teamAri } : options[0];
    const n = count(ward);
    return {
      key: ward,
      cells: [
        { key: 'w', content: <strong>{ward}</strong> },
        { key: 'n', content: n ? <Lozenge appearance={needs[ward].classI ? 'removed' : 'moved'}>{`${n} ${n === 1 ? 'device needs' : 'devices need'} action`}</Lozenge> : <span style={muted}>None need action</span> },
        { key: 't', content: (<div style={{ maxWidth: '320px' }}><Select inputId={`rr-team-${ward}`} aria-label={`Team for ${ward}`} spacing="compact" isDisabled={teams === null || busy === ward} isLoading={busy === ward} options={options} value={value} onChange={(o) => choose(ward, o.value)} menuPosition="fixed" /></div>) },
      ],
    };
  });

  return (
    <div style={{ paddingTop: sp(200) }}>
      <p style={{ ...muted, fontSize: '14px', maxWidth: '640px' }}>
        Pick the team that handles each ward. The list of teams is read from the Teamwork Graph (read-only) and shows the teams you belong to; the choice is saved in RecallRadar and used to suggest who should get a task. Nobody is assigned without you choosing it.
      </p>
      <div role="status" aria-live="polite">
        {loadError && <SectionMessage appearance="error" title="Could not load teams">{loadError}</SectionMessage>}
        {message && <SectionMessage appearance={message.kind}>{message.text}</SectionMessage>}
        {teams && teams.length === 0 && <SectionMessage appearance="information" title="No teams yet">You are not in any team in your Atlassian directory, so there is nothing to choose from.</SectionMessage>}
      </div>
      {teams === null && !loadError ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(100) }}><span role="status">Loading teams…</span></div>
      ) : null}
      {wardInfo.wards.length === 0 ? (
        <SectionMessage appearance="information" title="No wards yet">Load the demo hospital or import your devices; their wards appear here.</SectionMessage>
      ) : (
        <DynamicTable caption={<VisuallyHidden>Ward to team mapping</VisuallyHidden>} label="Ward teams" head={{ cells: [{ key: 'w', content: 'Ward', width: 22 }, { key: 'n', content: 'Needs action', width: 28 }, { key: 't', content: 'Team (from Teamwork Graph)' }] }} rows={rows} rowsPerPage={20} isFixedSize />
      )}
      {wardInfo.wards.length > 0 && (
        <p style={{ ...muted, marginTop: sp(150) }}>{wardInfo.mappings.length} of {wardInfo.wards.length} wards have a team. Wards with a Class I recall come first, then the wards with the most devices to act on.</p>
      )}
    </div>
  );
}
