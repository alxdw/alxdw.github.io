import { config } from './config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const token = params.get('invite') || '';
const preview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && params.get('preview') === '1';
const views = ['welcome', 'guests', 'address', 'decline', 'thanks'];
let invitation;
let previewApi;
let currentView = 'welcome';
let sending = false;
let submissionId;
let submissionPayload;
let lastAnswer;
let autocompleteStarted = false;
const choices = new Map();

function setPhoto(id, url, alt) {
  if (!url) return;
  const photo = new Image();
  photo.onload = () => { $(id).src = photo.src; if (alt) $(id).alt = alt; };
  // Keep the local illustration if the real photograph has not been supplied yet.
  photo.src = url;
}
setPhoto('lake-photo', config.photos.lake);
setPhoto('couple-photo', config.photos.couple, 'Becky and Alex');

function error(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

async function api(path, body) {
  if (preview) return previewApi(path, body);
  if (!config.apiBase) throw new Error('We’re putting the finishing touches to this page. Please send us a WhatsApp for now.');
  const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, invite: token }),
    cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) throw new Error('This invitation link isn’t available. Send us a WhatsApp for access.');
    throw new Error(result.error || 'We couldn’t save your reply. Please try again.');
  }
  return result;
}

function show(view, { navigate = true, focus = true } = {}) {
  if (!views.includes(view)) view = 'welcome';
  if (sending) { history.replaceState(null, '', `#${currentView}`); return; }
  if (view === 'address' && !selectedGuests().length) view = 'guests';
  if (view === 'thanks' && !lastAnswer) view = 'welcome';
  currentView = view;
  for (const name of views) $(`${name}-view`).hidden = name !== view;
  $('progress').hidden = ['welcome', 'thanks'].includes(view);
  $('step-label').textContent = view === 'guests' ? '1 of 2 · Your guests' : view === 'address' ? '2 of 2 · Your address' : 'Your reply';
  if (navigate) history.pushState(null, '', `#${view}`);
  if (focus) {
    $(`${view}-title`).focus({ preventScroll: true });
    const top = $('main').getBoundingClientRect().top + scrollY - 20;
    window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  if (view === 'address') {
    const attendingCount = selectedGuests().reduce((count, guest) => count + 1 + Number(!!choices.get(guest.id).plusCheck?.checked), 0);
    $('send-acceptance').firstChild.textContent = attendingCount === 1 ? 'Send my reply ' : 'Send our reply ';
    void startAutocomplete();
  }
}

function selectedGuests() {
  return invitation.guests.filter((guest) => choices.get(guest.id)?.checked);
}

function postalNames() {
  return selectedGuests().flatMap((guest) => {
    const choice = choices.get(guest.id);
    return [guest.name, ...(choice.plusCheck?.checked && choice.plusName.value.trim() ? [choice.plusName.value.trim()] : [])];
  }).join(' & ');
}

function renderGuests() {
  $('guest-options').replaceChildren();
  choices.clear();
  const existing = invitation.response;
  for (const guest of invitation.guests) {
    const row = document.createElement('div');
    row.className = 'guest-row';
    const label = document.createElement('label');
    label.className = 'guest-choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = guest.id;
    input.checked = existing && existing.answer !== 'no' ? existing.guestIds.includes(guest.id) : true;
    const name = document.createElement('span');
    name.textContent = guest.name;
    label.append(input, name);
    row.append(label);
    const choice = { input, get checked() { return input.checked; } };
    choices.set(guest.id, choice);
    if (guest.plusOne) {
      const plus = document.createElement('div');
      plus.className = 'plus-one';
      plus.hidden = !input.checked;
      const plusLabel = document.createElement('label');
      plusLabel.className = 'guest-choice';
      const plusCheck = document.createElement('input');
      plusCheck.type = 'checkbox';
      plusCheck.checked = !!existing?.plusOnes.some((person) => person.id === guest.plusOne.id);
      const plusText = document.createElement('span');
      plusText.textContent = 'I’ll be bringing a guest';
      plusLabel.append(plusCheck, plusText);
      const nameLabel = document.createElement('label');
      nameLabel.className = 'field';
      nameLabel.textContent = 'Guest’s name (optional)';
      nameLabel.hidden = !plusCheck.checked;
      const plusName = document.createElement('input');
      plusName.type = 'text';
      plusName.maxLength = 100;
      plusName.autocomplete = 'off';
      plusName.placeholder = 'You can tell us later';
      plusName.value = existing?.plusOnes.find((person) => person.id === guest.plusOne.id)?.name || guest.plusOne.name || '';
      nameLabel.append(plusName);
      plus.append(plusLabel, nameLabel);
      row.append(plus);
      Object.assign(choice, { plusCheck, plusName });
      input.addEventListener('change', () => { plus.hidden = !input.checked; });
      plusCheck.addEventListener('change', () => {
        nameLabel.hidden = !plusCheck.checked;
        if (plusCheck.checked) plusName.focus();
      });
    }
    $('guest-options').append(row);
  }
}

function addressValues() {
  return Object.fromEntries(['recipient', 'line1', 'line2', 'city', 'region', 'postcode', 'country'].map((key) => [key, $(key).value.trim()]));
}

function payload(answer) {
  const data = {
    answer,
    guestIds: answer === 'yes' ? selectedGuests().map((guest) => guest.id) : [],
    plusOnes: answer === 'yes' ? selectedGuests().filter((guest) => choices.get(guest.id).plusCheck?.checked).map((guest) => ({ id: guest.plusOne.id, name: choices.get(guest.id).plusName.value.trim() })) : [],
    address: answer === 'yes' ? addressValues() : null,
  };
  const fingerprint = JSON.stringify(data);
  if (!submissionId || submissionPayload !== fingerprint) submissionId = crypto.randomUUID();
  submissionPayload = fingerprint;
  return { ...data, submissionId };
}

async function submit(answer) {
  if (sending) return;
  const data = payload(answer);
  const errorId = answer === 'yes' ? 'address-error' : 'decline-error';
  error(errorId);
  sending = true;
  const button = answer === 'yes' ? $('send-acceptance') : $('send-decline');
  const oldLabel = button.innerHTML;
  const controls = [...document.querySelectorAll('#invitation button, #invitation input')];
  const disabled = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  button.textContent = 'Sending your reply…';
  $('invitation').setAttribute('aria-busy', 'true');
  let saved = false;
  try {
    const result = await api('response', data);
    if (!result.saved) throw new Error('We couldn’t confirm your reply was saved. Please try again.');
    invitation.response = data;
    lastAnswer = answer;
    $('existing-response').hidden = false;
    $('thanks-title').textContent = config.messages[answer].title;
    $('thanks-message').textContent = config.messages[answer].body;
    $('saved-label').textContent = preview ? 'PREVIEW COMPLETE · NO RESPONSE WAS SENT' : 'YOUR REPLY IS SAFELY WITH US';
    submissionId = undefined;
    saved = true;
  } catch (problem) {
    error(errorId, problem.name === 'TimeoutError' || problem instanceof TypeError
      ? 'We couldn’t confirm your reply. Your details are still here — please try again.'
      : problem.message);
  } finally {
    sending = false;
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    button.innerHTML = oldLabel;
    $('invitation').removeAttribute('aria-busy');
  }
  if (saved) show('thanks');
}

async function startAutocomplete() {
  if (autocompleteStarted || !config.googleMapsApiKey || preview) return;
  autocompleteStarted = true;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('Autocomplete timeout')), 10000);
      window.weddingMapsReady = () => { clearTimeout(timer); resolve(); };
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsApiKey)}&loading=async&libraries=places&v=weekly&callback=weddingMapsReady`;
      script.onerror = () => { clearTimeout(timer); reject(new Error('Autocomplete unavailable')); };
      script.async = true;
      document.head.append(script);
    });
    const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
    const widget = new PlaceAutocompleteElement();
    widget.setAttribute('aria-label', 'Find your postal address');
    $('autocomplete-container').append(widget);
    $('address-search').hidden = false;
    widget.addEventListener('gmp-error', () => { $('autocomplete-help').textContent = 'Address search is unavailable. Please enter your address below.'; });
    widget.addEventListener('gmp-select', async ({ placePrediction }) => {
      try {
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['addressComponents'] });
        const parts = place.addressComponents || [];
        const get = (type) => parts.find((part) => part.types.includes(type))?.longText || '';
        $('line1').value = [get('street_number'), get('route')].filter(Boolean).join(' ') || get('premise');
        $('line2').value = [get('subpremise'), get('street_number') && get('premise')].filter(Boolean).join(', ');
        $('city').value = get('postal_town') || get('locality') || get('administrative_area_level_2');
        $('region').value = get('administrative_area_level_1');
        $('postcode').value = [get('postal_code'), get('postal_code_suffix')].filter(Boolean).join('-');
        $('country').value = get('country');
        $('autocomplete-help').textContent = 'Address added. Please check the details, including any flat or house name.';
        submissionId = undefined;
        $('line1').focus();
      } catch {
        $('autocomplete-help').textContent = 'We couldn’t fill that address. You can enter it below.';
      }
    });
  } catch {
    // Manual address entry is always available, including blocked or failed Google scripts.
  }
}

function startAcceptance() {
  error('guests-error');
  show('guests');
}
$('accept-button').addEventListener('click', startAcceptance);
$('some-attending').addEventListener('click', startAcceptance);
$('decline-button').addEventListener('click', () => show('decline'));
$('back-button').addEventListener('click', () => show(currentView === 'address' ? 'guests' : 'welcome'));
$('edit-response').addEventListener('click', () => show('welcome'));
$('send-decline').addEventListener('click', () => void submit('no'));
$('guests-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!selectedGuests().length) {
    error('guests-error', 'Please select someone who’s coming, or go back and choose “We can’t make it”.');
    return;
  }
  error('guests-error');
  if (!$('recipient').value.trim() || $('recipient').dataset.generated === 'true') {
    $('recipient').value = postalNames();
    $('recipient').dataset.generated = 'true';
  }
  show('address');
});
$('recipient').addEventListener('input', () => { $('recipient').dataset.generated = 'false'; });
$('invitation').addEventListener('input', () => { submissionId = undefined; });
$('address-form').addEventListener('submit', (event) => { event.preventDefault(); void submit('yes'); });
window.addEventListener('hashchange', () => { if (invitation) show(location.hash.slice(1), { navigate: false }); });

async function initialise() {
  $('retry-access').hidden = true;
  if (!preview && !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  $('access-message').textContent = 'Opening your invitation…';
  try {
    if (preview) {
      ({ previewApi } = await import('./preview.js'));
      $('preview-banner').hidden = false;
    }
    invitation = await api('invitation', {});
    if (!invitation.guests?.length) throw new Error('We’re checking the details of your invitation. Please send us a WhatsApp.');
    renderGuests();
    const singular = invitation.guests.length === 1;
    $('greeting').textContent = invitation.greeting || `FOR ${invitation.guests.map((guest) => guest.name).join(' & ')}`;
    if (singular) {
      $('accept-button').firstChild.textContent = 'Yes, I’d love to come ';
      $('decline-button').textContent = 'Sorry, I can’t make it';
    }
    $('existing-response').hidden = !invitation.response;
    if (invitation.response?.address) {
      for (const [key, value] of Object.entries(invitation.response.address)) if ($(key)) $(key).value = value;
    }
    $('access-view').hidden = true;
    $('invitation').hidden = false;
    $('date-seal').hidden = false;
    $('footer').hidden = false;
    $('hero').classList.remove('hero--locked');
    document.title = 'Becky & Alex · Save the date';
    history.replaceState(null, '', `${location.pathname}${location.search}#welcome`);
    show('welcome', { navigate: false, focus: false });
  } catch (problem) {
    $('access-message').textContent = problem.name === 'TimeoutError' || problem instanceof TypeError
      ? 'We couldn’t open your invitation. Please try again, or send us a WhatsApp.' : problem.message;
    $('retry-access').hidden = false;
  }
}
$('retry-access').addEventListener('click', () => void initialise());
void initialise();
