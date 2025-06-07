const urlInput = document.getElementById('project-url');
const fetchButton = document.getElementById('fetch-button');
const historyContainer = document.getElementById('history-container');
const loader = document.getElementById('loader');
const errorContainer = document.getElementById('error-container');
const analyzeSection = document.getElementById('analysis-section');
const analyzeButton = document.getElementById('analyze-button');
const analysisLoader = document.getElementById('analysis-loader');
const analysisContainer = document.getElementById('analysis-container');
const guidancePromptInput = document.getElementById('guidance-prompt');

let promptsForAnalysis = [];
let urlReferences = [];
let originalMasterPrompt = '';

fetchButton.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
        showError('Please enter a project URL, ID, or slug.');
        return;
    }

    clearUI();
    promptsForAnalysis = [];
    loader.style.display = 'block';

    try {
        const projectId = await resolveProjectId(url);
        if (!projectId) {
            showError('Invalid input. Please use a project ID, a project URL (e.g., /p/...), or a user slug (e.g., @username/project-slug).');
            loader.style.display = 'none';
            return;
        }

        const project = await getProject(projectId);
        const history = await fetchAllRevisions(projectId);

        let parentHistory = null;
        let parentProject = null;
        if (project && project.parent_id) {
            parentProject = await getProject(project.parent_id);
            parentHistory = await fetchAllRevisions(project.parent_id);
        }

        renderHistory(history, parentHistory, parentProject, project);

    } catch (err) {
        showError(err.message);
    } finally {
        loader.style.display = 'none';
    }
});

urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        fetchButton.click();
    }
});

analyzeButton.addEventListener('click', async () => {
    if (promptsForAnalysis.length === 0) {
        showError("No prompts available to analyze.");
        return;
    }

    analysisLoader.style.display = 'block';
    analysisContainer.innerHTML = '';
    analyzeButton.disabled = true;

    const guidanceText = guidancePromptInput.value.trim();

    const formattedPrompts = promptsForAnalysis.map(p => {
        let prefix = p.source === 'parent' ? `Parent V${p.version}` : `V${p.version}`;
        return `${prefix} (${p.type}):\n${p.text}`;
    }).join('\n\n---\n\n');

    let systemPrompt = `You are an expert prompt engineer. You will be given a sequence of prompts that were used to build a web application. This sequence may include prompts from a parent project and a forked project. Your task is to analyze this entire history and synthesize it into a single, comprehensive, and detailed prompt that could be used to create the final version of the project from scratch.

The final prompt should be:
- **Comprehensive:** It should include all features, functionality, styling, and layout mentioned in the prompt history.
- **Well-structured:** Use headings, bullet points, or other formatting to make the prompt easy to read and understand.
- **Coherent:** Combine related ideas and resolve contradictions or iterative changes into a final, consistent instruction.
- **Actionable:** The output should be a single block of text that a generative AI could use to build the web page.

Do not include any preamble or explanation of what you are doing. Respond ONLY with the final, synthesized prompt.`;

    if (guidanceText) {
        systemPrompt += `\n\n---\n\n**User Guidance:** A user has provided additional instructions. You MUST follow these instructions and incorporate them into your final generated prompt. The user's instructions are:\n\n"${guidanceText}"`;
    }

    try {
        const completion = await websim.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Here is the prompt history:\n\n${formattedPrompts}` }
            ],
        });

        const generatedPrompt = completion.content;
        originalMasterPrompt = generatedPrompt.replace(/^```[a-z]*\s*\n?/, '').replace(/\n?```$/, '').trim();

        analysisContainer.innerHTML = `
            <div class="analysis-header">
                <h3>Generated Master Prompt</h3>
                <button id="copy-prompt-button">Copy</button>
            </div>
             <div id="url-controls" style="display: none;">
                <strong>Toggle URLs:</strong>
                <div id="url-toggles"></div>
                <button id="toggle-all-urls">Toggle All</button>
            </div>
            <p>This prompt is a synthesis of the project's entire history. You can use it to try and recreate a similar project.</p>
            <div class="prompt-text"></div>
        `;
        
        setupUrlToggles();
        updatePromptDisplay();

        const copyButton = document.getElementById('copy-prompt-button');
        copyButton.addEventListener('click', () => {
            const textToCopy = analysisContainer.querySelector('.prompt-text').textContent;
            navigator.clipboard.writeText(textToCopy).then(() => {
                copyButton.textContent = 'Copied!';
                copyButton.classList.add('copied');
                setTimeout(() => {
                    copyButton.textContent = 'Copy';
                    copyButton.classList.remove('copied');
                }, 2000);
            }).catch(err => {
                console.error('Could not copy text: ', err);
                copyButton.textContent = 'Failed!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy';
                }, 2000);
            });
        });

    } catch (err) {
        console.error('LLM analysis failed:', err);
        const errorP = document.createElement('p');
        errorP.style.color = 'red';
        errorP.textContent = `Failed to generate prompt. ${err.message}`;
        analysisContainer.appendChild(errorP);
    } finally {
        analysisLoader.style.display = 'none';
        analyzeButton.disabled = false;
    }
});

function setupUrlToggles() {
    const urlRegex = /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*))/g;
    const urls = [...new Set(originalMasterPrompt.match(urlRegex) || [])];
    
    const urlControls = document.getElementById('url-controls');
    const urlTogglesContainer = document.getElementById('url-toggles');
    const toggleAllBtn = document.getElementById('toggle-all-urls');

    urlTogglesContainer.innerHTML = '';
    urlReferences = [];
    if (toggleAllBtn._handler) {
        toggleAllBtn.removeEventListener('click', toggleAllBtn._handler);
        delete toggleAllBtn._handler;
    }

    if (urls.length > 0) {
        urlControls.style.display = 'flex';

        urls.forEach((url, index) => {
            const ref = { id: index, url: url, toggledOn: true };
            urlReferences.push(ref);

            const icon = document.createElement('span');
            icon.className = 'url-toggle-icon';
            icon.textContent = `URL ${index + 1}`;
            icon.title = url;
            icon.dataset.urlId = index;

            icon.addEventListener('click', () => {
                ref.toggledOn = !ref.toggledOn;
                icon.classList.toggle('toggled-off', !ref.toggledOn);
                updatePromptDisplay();
            });
            urlTogglesContainer.appendChild(icon);
        });

        toggleAllBtn._handler = () => {
            const isAnyOff = urlReferences.some(ref => !ref.toggledOn);
            urlReferences.forEach(ref => {
                ref.toggledOn = isAnyOff;
            });
            
            document.querySelectorAll('.url-toggle-icon').forEach(icon => {
                const ref = urlReferences.find(r => r.id === parseInt(icon.dataset.urlId));
                icon.classList.toggle('toggled-off', !ref.toggledOn);
            });
            updatePromptDisplay();
        };
        toggleAllBtn.addEventListener('click', toggleAllBtn._handler);
    } else {
        urlControls.style.display = 'none';
    }
}

function updatePromptDisplay() {
    const promptContainer = analysisContainer.querySelector('.prompt-text');
    if (!promptContainer) return;

    let textToShow = originalMasterPrompt;
    urlReferences.forEach(ref => {
        if (!ref.toggledOn) {
            const regex = new RegExp(ref.url.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
            textToShow = textToShow.replace(regex, `[URL ${ref.id + 1} HIDDEN]`);
        }
    });

    promptContainer.textContent = textToShow;
}

async function resolveProjectId(input) {
    input = input.trim();

    // 1. Project ID
    if (input.length === 20 && /^[a-z0-9_-]+$/.test(input)) {
        return input;
    }

    // 2. Project URL: /p/PROJECT_ID
    let match = input.match(/\/p\/([a-z0-9_-]{20})/);
    if (match) {
        return match[1];
    }

    // 3. Slug URL: /@username/slug or @username/slug
    match = input.match(/@([a-zA-Z0-9_]{3,32})\/([a-zA-Z0-9-]{3,50})/);
    if (match) {
        const username = match[1];
        const slug = match[2];
        const apiUrl = `/api/v1/users/${username}/slugs/${slug}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`Project not found for user @${username} with slug "${slug}".`);
            }
            throw new Error(`Failed to fetch project by slug. Status: ${response.status}`);
        }
        const data = await response.json();
        if (data && data.project && data.project.id) {
            return data.project.id;
        } else {
            throw new Error('Could not get project ID from slug response.');
        }
    }

    return null;
}

async function getProject(projectId) {
    const response = await fetch(`/api/v1/projects/${projectId}`);
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Project with ID ${projectId} not found.`);
        }
        throw new Error(`Failed to fetch project data. Status: ${response.status}`);
    }
    const data = await response.json();
    return data.project;
}

async function fetchAllRevisions(projectId) {
    let allRevisions = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
        const apiUrl = `/api/v1/projects/${projectId}/revisions?first=100${cursor ? `&after=${cursor}` : ''}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Project not found. Please check the URL or ID.');
            }
            throw new Error(`Failed to fetch revisions. Status: ${response.status}`);
        }

        const data = await response.json();
        const revisionsData = data.revisions.data;

        if (!revisionsData || revisionsData.length === 0) {
            break;
        }

        allRevisions.push(...revisionsData);
        hasNextPage = data.revisions.meta.has_next_page;
        cursor = data.revisions.meta.end_cursor;
    }

    return allRevisions;
}

function renderRevisionList(revisions, container) {
    const validRevisions = revisions.filter(item => item.site && item.site.prompt && item.site.prompt.text);

    if (validRevisions.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'No prompt history found for this project.';
        container.appendChild(p);
        return;
    }

    const fragment = document.createDocumentFragment();
    validRevisions.forEach(item => {
        const { project_revision, site } = item;
        const prompt = site.prompt;

        const revisionElement = document.createElement('div');
        revisionElement.className = 'revision-item';

        const header = document.createElement('div');
        header.className = 'revision-header';
        header.innerHTML = `<strong>Version ${project_revision.version}</strong> <span class="prompt-type">(${prompt.type})</span>`;

        const promptText = document.createElement('p');
        promptText.className = 'prompt-text';
        promptText.textContent = prompt.text;

        revisionElement.appendChild(header);
        revisionElement.appendChild(promptText);

        fragment.appendChild(revisionElement);
    });

    container.appendChild(fragment);
}

function renderHistory(revisions, parentRevisions, parentProject, project) {
    historyContainer.innerHTML = '';

    const hasHistory = revisions.some(item => item.site && item.site.prompt && item.site.prompt.text);
    const hasParentHistory = parentRevisions && parentRevisions.some(item => item.site && item.site.prompt && item.site.prompt.text);

    if (!hasHistory && !hasParentHistory) {
        historyContainer.innerHTML = '<p>No prompt history found for this project or its parent.</p>';
        return;
    }

    if (parentRevisions && parentProject) {
        const parentHeader = document.createElement('h2');
        const parentLink = document.createElement('a');
        parentLink.href = `/p/${parentProject.id}`;
        parentLink.target = '_blank';
        parentLink.textContent = parentProject.title || `Project ${parentProject.id}`;

        parentHeader.textContent = `Parent Project History: `;
        parentHeader.appendChild(parentLink);
        historyContainer.appendChild(parentHeader);
        
        const sortedParentRevisions = parentRevisions.sort((a, b) => a.project_revision.version - b.project_revision.version);
        renderRevisionList(sortedParentRevisions, historyContainer);

        const parentPrompts = sortedParentRevisions
            .filter(item => item.site && item.site.prompt && item.site.prompt.text)
            .map(item => ({
                source: 'parent',
                version: item.project_revision.version,
                type: item.site.prompt.type,
                text: item.site.prompt.text
            }));
        promptsForAnalysis.push(...parentPrompts);
    }

    const projectHeader = document.createElement('h2');
    let projectTitleText = `History for ${project.title || `Project ${project.id}`}`;
    if (project.parent_id) {
        projectTitleText += ' (Fork)';
    }
    projectHeader.textContent = projectTitleText;
    historyContainer.appendChild(projectHeader);
    
    const sortedRevisions = revisions.sort((a,b) => a.project_revision.version - b.project_revision.version);
    renderRevisionList(sortedRevisions, historyContainer);

    const projectPrompts = sortedRevisions
        .filter(item => item.site && item.site.prompt && item.site.prompt.text)
        .map(item => ({
            source: 'current',
            version: item.project_revision.version,
            type: item.site.prompt.type,
            text: item.site.prompt.text
        }));
    promptsForAnalysis.push(...projectPrompts);

    if (promptsForAnalysis.length > 0) {
        analyzeSection.style.display = 'block';
        analyzeButton.disabled = false;
        analysisLoader.style.display = 'none';
    }
}

function showError(message) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
}

function clearUI() {
    historyContainer.innerHTML = '';
    errorContainer.textContent = '';
    errorContainer.style.display = 'none';
    analysisContainer.innerHTML = '';
    analyzeSection.style.display = 'none';
}