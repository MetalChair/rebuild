import { useState } from "react";
import { Link } from "react-router-dom";
import { api, dbKey, profilePhotoURL, type ProfilePhoto } from "../api";
import { Empty, ErrorBox, Modal, Spinner } from "../components/ui";
import { isoDate, longDate, useAsync, useLocalStorage } from "../util";

export default function PhotographsPage() {
  const profiles = useAsync(() => api.profiles(), []);
  const [selected, setSelected] = useLocalStorage<number | null>(dbKey("dp.profile"), null);
  const profile = profiles.data?.find(p => p.id === selected) ?? profiles.data?.[0];
  return <section className="content">
    <div className="page-head">
      <h1>Photographs</h1>
      {profile && (profiles.data?.length ?? 0) > 1 && <select className="photo-profile" aria-label="Profile" value={profile.id} onChange={e => setSelected(Number(e.target.value))}>
        {profiles.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>}
    </div>
    {profiles.loading && !profile && <Spinner />}
    {profiles.error && <ErrorBox error={profiles.error} onRetry={profiles.reload} />}
    {!profiles.loading && !profiles.error && !profile && <Empty><Link to="/profiles">Create a profile</Link> to keep a photograph diary.</Empty>}
    {profile && <PhotoAlbum key={profile.id} profile={profile.id} />}
  </section>;
}

function PhotoAlbum({ profile }: { profile: number }) {
  const photos = useAsync(() => api.profilePhotos(profile), [profile]);
  const [adding, setAdding] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [open, setOpen] = useState<ProfilePhoto | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const entries = photos.data ?? [];
  const latest = entries[entries.length - 1];

  async function remove(photo: ProfilePhoto) {
    if (!confirm("Remove this photograph from the profile?")) return;
    setRemoving(photo.id);
    setError("");
    try {
      await api.deleteProfilePhoto(profile, photo.id);
      photos.setData(entries.filter(item => item.id !== photo.id));
    } catch (err) {
      setError(String(err));
    } finally {
      setRemoving(null);
    }
  }

  return <>
    <div className="row wrap photo-toolbar">
      <button className="btn btn-primary" disabled={removing !== null} onClick={() => setAdding(true)}>Add photograph</button>
      {entries.length > 1 && <button className="btn" onClick={() => setComparing(!comparing)}>{comparing ? "Show all photographs" : "Compare first and last"}</button>}
    </div>
    {photos.loading && !photos.data && <Spinner />}
    {(error || photos.error) && <ErrorBox error={error || photos.error!} />}
    {!photos.loading && entries.length === 0 && <Empty>Add a dated photograph to start this profile’s album.</Empty>}
    {comparing && entries.length > 1 ? <div className="photo-compare">
      {[entries[0], latest].map((photo, index) => <figure className="panel" key={photo.id}>
        <h2>{index === 0 ? "First photograph" : "Latest photograph"}</h2>
        <button className="photo-preview" aria-label={"Open photograph from " + longDate(photo.date)} onClick={() => setOpen(photo)}>
          <img src={profilePhotoURL(profile, photo.id)} alt={photo.caption || longDate(photo.date)} />
        </button>
        <figcaption>{longDate(photo.date)}{photo.caption && " · " + photo.caption}</figcaption>
      </figure>)}
    </div> : <div className="photo-album">
      {[...entries].reverse().map(photo => <figure className="panel" key={photo.id}>
        <button className="photo-preview" aria-label={"Open photograph from " + longDate(photo.date)} onClick={() => setOpen(photo)}>
          <img loading="lazy" src={profilePhotoURL(profile, photo.id)} alt={photo.caption || longDate(photo.date)} />
        </button>
        <figcaption>
          <strong>{longDate(photo.date)}</strong>{photo.caption && <p>{photo.caption}</p>}
        </figcaption>
        <button className="btn btn-sm danger" disabled={removing !== null} onClick={() => void remove(photo)}>Remove photograph</button>
      </figure>)}
    </div>}
    {adding && <AddPhotograph profile={profile} onClose={() => setAdding(false)} onSaved={photo => {
      const next = [...entries, photo].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      photos.setData(next);
      setAdding(false);
    }} />}
    {open && <Modal title={longDate(open.date)} onClose={() => setOpen(null)} wide>
      <img className="photo-full" src={profilePhotoURL(profile, open.id)} alt={open.caption || longDate(open.date)} />
      {open.caption && <p>{open.caption}</p>}
    </Modal>}
  </>;
}

function AddPhotograph({ profile, onSaved, onClose }: { profile: number; onSaved: (p: ProfilePhoto) => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(isoDate(new Date()));
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="Add photograph" onClose={() => { if (!busy) onClose(); }}>
    <form className="stack" onSubmit={async event => {
      event.preventDefault();
      if (!file || !date || busy) return;
      setError("");
      if (file.size > 12 * 1024 * 1024) { setError("Choose an image up to 12 MB."); return; }
      setBusy(true);
      try { onSaved(await api.addProfilePhoto(profile, date, caption, file)); }
      catch (err) { setError(String(err)); }
      finally { setBusy(false); }
    }}>
      <label>Image file <input type="file" accept="image/jpeg,image/png,image/gif" required onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <label>Date <input type="date" value={date} required onChange={e => setDate(e.target.value)} /></label>
      <label>Caption <input value={caption} maxLength={180} onChange={e => setCaption(e.target.value)} /></label>
      <small className="muted">JPEG, PNG, or GIF. Saved with this profile in DietPro.db.</small>
      {error && <ErrorBox error={error} />}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !date || !file}>Save photograph</button>
        <button className="btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </form>
  </Modal>;
}
