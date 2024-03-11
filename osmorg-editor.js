var editorArea = null;
var textArea = null;
var saveButton = null;
var errorPane = null;
var originalPanel = null;
var originalObject = null;

const apiBase = 'https://www.openstreetmap.org/api/0.6/';

// Replaces the input area with the original object info.
function closeEditor() {
    editorArea.replaceWith(originalPanel);
    originalObject = null;
    editorArea = null;
}

// Sets the content for previously inserted errorPane.
function setError(message) {
    if (!message)
        errorPane.textContent = '';
    else
        errorPane.textContent = message;
}

// Extracts type and id from the URL.
function getTypeAndRef() {
    const baseParts = window.location.pathname.split('/');
    let i = 0;
    while (i < baseParts.length && baseParts[i] != 'node' && baseParts[i] != 'way' && baseParts[i] != 'relation') i++;
    if (i >= baseParts.length) return null;
    return {
        type: baseParts[i],
        ref: baseParts[i + 1],
        part: baseParts[i] + '/' + baseParts[i + 1]
    };
}

// Queries OSM API for the element data and populates the text area.
function queryForTags() {
    const typeRef = getTypeAndRef();
    if (!typeRef) {
        closeEditor();
        return;
    }
    const url = apiBase + typeRef.part + '.json';
    fetch(url).then(response => response.json()).then(response => {
        // If the element was deleted, or there have been an error, close the editor.
        if (!response.elements) {
            closeEditor();
            return;
        }

        // Store the original object for uploading it later.
        originalObject = response.elements[0];
        let tags = [];
        if (originalObject.tags) {
            for (const [k, v] of Object.entries(originalObject.tags)) {
                tags.push(k + ' = ' + v.replaceAll('\n', '\\\\'));
            }
        }
        textArea.value = tags.join('\n');;
        textArea.focus();
        // We built the editor with a disabled saving button.
        saveButton.disabled = null;
    }).catch(err => {
        // On error we just close the editor without an error message.
        console.log({dataFetchingError: err});
        closeEditor();
    });
}

// Reads new tags off the text area and returns a json object..
function buildTags() {
    const lines = textArea.value.split('\n');
    let json = {};
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const eqPos = line.indexOf('=');
        if (eqPos <= 0 || eqPos == line.length - 1) continue;
        const k = line.substring(0, eqPos).trim();
        const v = line.substring(eqPos + 1).trim();
        if (v == '' || k == '') continue;
        json[k] = v.replaceAll('\\\\', '\n');
    }
    return json;
}

// Returns an object with three lists of keys that were added/changed/removed between newTags and oldTags.
function getModifiedKeys(newTags, oldTags) {
    let keys = {added: [],
                changed: [],
                removed: []};
    for (const [k, v] of Object.entries(newTags)) {
        if (!oldTags.hasOwnProperty(k)) {
            keys.added.push(k);
        } else if (oldTags[k] != v) {
            keys.changed.push(k);
        }
    }
    for (const [k, v] of Object.entries(oldTags)) {
        if (!newTags.hasOwnProperty(k))
            keys.removed.push(k);
    }
    return keys;
}

// Converts an object to an XML string.
function tagsToXml(doc, node, tags) {
    for (const [k, v] of Object.entries(tags)) {
        let tag = doc.createElement('tag');
        tag.setAttribute('k', k);
        tag.setAttribute('v', v);
        node.appendChild(tag);
    }
}

// Builds and returns a version of the object to upload with new tags.
function buildObject(doc, tags) {
    let elem = doc.createElement(originalObject.type);
    elem.setAttribute('version', originalObject.version);
    elem.setAttribute('id', originalObject.id);
    elem.setAttribute('visible', 'true');
    if (originalObject.lat && originalObject.lon) {
        elem.setAttribute('lat', originalObject.lat);
        elem.setAttribute('lon', originalObject.lon);
    }
    if (originalObject.nodes) {
        for (let i = 0; i < originalObject.nodes.length; i++) {
            let nd = doc.createElement('nd');
            nd.setAttribute('ref', originalObject.nodes[i]);
            elem.appendChild(nd);
        }
    } else if (originalObject.members) {
        for (let i = 0; i < originalObject.members.length; i++) {
            let member = doc.createElement('member');
            member.setAttribute('type', originalObject.members[i].type);
            member.setAttribute('ref', originalObject.members[i].ref);
            member.setAttribute('role', originalObject.members[i].role);
            elem.appendChild(member);
        }
    }
    tagsToXml(doc, elem, tags);
    return elem;
}

// Creates an OSM-Auth object instance.
function makeAuth() {
    return osmAuth.osmAuth({
        // Put your own credentials here.
        client_id: "FwA",
        client_secret: "ZUq",
        // Hopefully this page is never used.
        redirect_uri: chrome.runtime.getURL('land.html'),
        scope: "write_api",
        auto: true
    });
}

// Uploads changes made in the text area, if any.
function uploadTags() {
    setError();
    if (!originalObject) return;
    const xmlHeader = '<?xml version="1.0" encoding="utf-8"?>';
    const newTags = buildTags();
    const modifiedKeys = getModifiedKeys(newTags, originalObject['tags'] || {});
    if (modifiedKeys.added.length + modifiedKeys.changed.length + modifiedKeys.removed.length == 0) {
        // If the tags are intact, just close the editor.
        closeEditor();
        return;
    }
    // Iterate over possible actions and build the changeset comment
    // For example 'Added tag smoothness to / Changed tags surface, ref of way 12345'.
    const possibleActions = [['added', 'to'], ['changed', 'of'], ['removed', 'from']];
    let changesetComment = '';
    for (const [action, preposition] of possibleActions) {
        if (modifiedKeys[action].length > 0) {
            // 'Changed tags surface, ref of way 12345'
            const actionComment = action.charAt(0).toUpperCase() + action.slice(1) + ' tag' +
                (modifiedKeys[action].length > 1 ? 's ' : ' ') + modifiedKeys[action].join(', ') + ' ' + preposition;
            // Append the action comment to the changeset comment
            changesetComment += (changesetComment.length > 0 ? ' / ' : '') + actionComment;
        }
    }
    changesetComment += ' of ' + typeRef.type + ' ' + typeRef.ref;
    
    // Prepare changeset payload.
    const typeRef = getTypeAndRef();
    const changesetTags = {
        'created_by': 'Osm.Org Tags Editor',
        'comment': changesetComment
    };
    let changesetPayload = document.implementation.createDocument(null, 'osm');
    let cs = changesetPayload.createElement('changeset');
    changesetPayload.documentElement.appendChild(cs);
    tagsToXml(changesetPayload, cs, changesetTags);
    const chPayloadStr = xmlHeader + new XMLSerializer().serializeToString(changesetPayload);

    // Open changeset.
    const auth = makeAuth();
    auth.xhr({
        method: 'PUT',
        path: apiBase + 'changeset/create',
        prefix: false, // not relying on the default prefix.
        headers: { 'Content-Type': 'application/xml' },
        content: chPayloadStr
    }, function(err, result) {
        if (err) {
            console.log({changesetError: err});
            if (err.type)
                setError('Could not create a changeset because of a network error');
            else
                setError('Could not create a changeset. Error ' + err.status + ': ' + err.responseText);
            return;
        }
        const changesetId = result;

        // Create XML with element payload.
        let elemPayload = document.implementation.createDocument(null, 'osm');
        let elem = buildObject(elemPayload, newTags);
        elem.setAttribute('changeset', changesetId);
        elemPayload.documentElement.appendChild(elem);
        const elemPayloadStr = xmlHeader + new XMLSerializer().serializeToString(elemPayload);

        // Upload the new element.
        auth.xhr({
            method: 'PUT',
            path: apiBase + typeRef.part,
            prefix: false,
            headers: { 'Content-Type': 'application/xml' },
            content: elemPayloadStr
        }, function(err, result) {
            // Close the changeset regardless.
            auth.xhr({
                method: 'PUT',
                path: apiBase + 'changeset/' + changesetId + '/close',
                prefix: false
            }, function(err1, result) {
                // Only after closing the changeset reload the page.
                // Otherwise the request gets cancelled, and the changeset is not closed.
                if (!err) {
                    closeEditor();
                    window.location.reload();
                }
            });

            if (err) {
                console.log({uploadError: err});
                if (err.type)
                    setError('Could not upload data because of a network error');
                else
                    setError('Could not upload data. Error ' + err.status + ': ' + err.responseText);
            }
        });
    });
}

// Build the editor panel with all the fields.
function createEditorPanel() {
    // The text area is copied from the "create note" action.
    textArea = document.createElement('textarea');
    textArea.className = 'form-control';
    textArea.rows = 10;
    textArea.cols = 40;
    textArea.style.fontFamily = 'monospace';

    // Again, this is the common styling of osm.org's buttons.
    saveButton = document.createElement('input');
    saveButton.type = 'submit';
    saveButton.name = 'save';
    saveButton.className = 'btn btn-primary';
    saveButton.value = 'Save';
    // Disabled until we load the text area contents.
    saveButton.disabled = '1';

    let cancelButton = document.createElement('input');
    cancelButton.type = 'submit';
    cancelButton.name = 'cancel';
    cancelButton.className = 'btn btn-danger';
    cancelButton.value = 'Cancel';
    cancelButton.addEventListener('click', function(e) {
        // Nothing to save, just return the original panel.
        closeEditor();
        e.preventDefault();
    });

    // As the rest of the website, it uses a form to catch the submit event.
    editorArea = document.createElement('form');
    editorArea.action = '#';
    editorArea.addEventListener('submit', function(e) {
        uploadTags();
        e.preventDefault();
        return false;
    });

    // Area 1 is the text area, area 2 is the button row.
    let editorArea1 = document.createElement('div');
    editorArea1.className = 'form-group';
    editorArea1.append(textArea);
    let editorArea2 = document.createElement('div');
    editorArea2.className = 'btn-wrapper';
    editorArea2.append(saveButton);
    editorArea2.append(' ');
    editorArea2.append(cancelButton);

    errorPane = document.createElement('div');
    errorPane.style.color = 'darkred';
    errorPane.style.paddingBottom = '20px';

    editorArea.append(editorArea1);
    editorArea.append(errorPane);
    editorArea.append(editorArea2);
    return editorArea;
}

// Checks for the authentication, and replaces the info panel with the editor.
function openEditor() {
    // Do not open the editor twice.
    if (editorArea) return;

    // Check for authentication (snatched from the iD editor).
    const auth = makeAuth();
    if (!auth.authenticated()) {
        if (document.getElementById('open-id-editor-panel')) return;
        let idPanel = document.createElement('div');
        idPanel.id = 'open-id-editor-panel';
        idPanel.style.color = 'darkred';
        idPanel.style.paddingBottom = '20px';
        idPanel.innerHTML = 'Please open <a href="https://www.openstreetmap.org/edit' +
            window.location.hash + '">iD editor</a> first to generate an authentication token.';

        const actions = document.querySelector('.secondary-actions');
        actions.parentNode.insertBefore(idPanel, actions);
        return;
    }

    // If authenticated, replace the info block with the editor panel.
    originalPanel.replaceWith(createEditorPanel());

    // And send a query to download tags.
    queryForTags();
}

// Adds the "Edit Tags" button if there is a place for it, and it's not already there.
function addTheButton() {
    // Prevent duplicate button
    if (document.querySelector('.edit_tags_class')) return true;

    const actions = document.querySelector('.secondary-actions');
    originalPanel = document.querySelector('.browse-section');
    if (!actions || !originalPanel) return false;

    let atag = document.createElement('a');
    atag.className = 'edit_tags_class';
    atag.href = '#';
    atag.append('Edit Tags');
    atag.addEventListener('click', function(e) {
        openEditor();
        e.preventDefault();
        return false;
    })

    actions.append(' · ');
    actions.append(atag);
    return true;
}

// Called from the background service, adds the "Edit Tags" button.
function updateButton(data, sender, sendResponse) {
    // Calling multiple times in case the sidebar doesn't load.
    if (!addTheButton()) {
        window.setTimeout(function() {
            if (!addTheButton()) {
                window.setTimeout(addTheButton, 1000);
            }
        }, 300);
    }
}

// When opening the element page directly, the background process does not run.
updateButton();

// Listen to messages from the background script.
chrome.runtime.onMessage.addListener(updateButton);
