
        document.addEventListener('DOMContentLoaded', async function() {
            const API_URL = `http://${window.location.hostname}:5000`;

            const profileIcon = document.getElementById('profile-icon');
            const dropdownMenu = document.getElementById('dropdown-menu');
            const addAssetModal = document.getElementById('add-asset-modal');
            const openModalBtn = document.getElementById('add-asset-btn');
            const closeModalBtn = document.getElementById('modal-close-btn');
            const cancelModalBtn = document.getElementById('modal-cancel-btn');
            const addAssetForm = document.getElementById('add-asset-form');
            const assetsTable = document.getElementById('assets-table');
            const assetsTableBody = document.getElementById('assets-table-body');
            const emptyState = document.getElementById('empty-state');
            const statsGrid = document.getElementById('stats-grid');
            const insightsGrid = document.getElementById('insights-grid');
            const modalTitle = document.getElementById('modal-title');
            const modalSubmitBtn = document.getElementById('modal-submit-btn');
            const assetIdField = document.getElementById('asset-id');
            const deleteConfirmModal = document.getElementById('delete-confirm-modal');
            const deleteConfirmBtn = document.getElementById('delete-confirm-btn');
            const deleteCancelBtn = document.getElementById('delete-cancel-btn');

            let editingAssetId = null;
            let deletingAssetId = null;
            const token = localStorage.getItem('authToken');
            if (!token) {
                alert('You are not logged in. Redirecting to login.');
                window.location.href = 'index.html';
                return;
            }

            profileIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                dropdownMenu.classList.toggle('active');
            });
            window.addEventListener('click', (event) => {
                if (!profileIcon.contains(event.target) && !dropdownMenu.contains(event.target)) {
                    dropdownMenu.classList.remove('active');
                }
            });

            const openModal = (mode = 'add', data = {}) => {
                addAssetForm.reset();
                editingAssetId = null;
                if (mode === 'add') {
                    modalTitle.textContent = 'Add a New Asset';
                    modalSubmitBtn.textContent = 'Save Asset';
                    assetIdField.value = '';
                } else if (mode === 'edit') {
                    modalTitle.textContent = 'Edit Asset';
                    modalSubmitBtn.textContent = 'Update Asset';
                    document.getElementById('asset-type').value = data.type;
                    document.getElementById('asset-name').value = data.name;
                    document.getElementById('asset-quantity').value = data.quantity;
                    document.getElementById('asset-price').value = data.price;
                    editingAssetId = data.id;
                }
                addAssetModal.classList.add('active');
            };
            const closeModal = () => addAssetModal.classList.remove('active');

            openModalBtn.addEventListener('click', () => openModal('add'));
            closeModalBtn.addEventListener('click', closeModal);
            cancelModalBtn.addEventListener('click', closeModal);
            addAssetModal.addEventListener('click', (event) => {
                if (event.target === addAssetModal) closeModal();
            });

            deleteCancelBtn.addEventListener('click', () => {
                deleteConfirmModal.classList.remove('active');
                deletingAssetId = null;
            });

            deleteConfirmBtn.addEventListener('click', async () => {
                if (!deletingAssetId) return;
                try {
                    const resp = await fetch(`${API_URL}/assets/${deletingAssetId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!resp.ok) throw new Error('Delete failed');
                    const row = assetsTableBody.querySelector(`tr[data-id="${deletingAssetId}"]`);
                    if (row) row.remove();
                    updateDashboardVisibility();
                } catch (err) {
                    console.error('Delete error', err);
                    alert('Failed to delete asset. See console for details.');
                } finally {
                    deleteConfirmModal.classList.remove('active');
                    deletingAssetId = null;
                }
            });

            addAssetForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const formData = new FormData(addAssetForm);
                const asset = {
                    type: formData.get('type'),
                    name: formData.get('name'),
                    quantity: parseFloat(formData.get('quantity')),
                    price: parseFloat(formData.get('price'))
                };

                if (editingAssetId) {
                    // Update
                    try {
                        const resp = await fetch(`${API_URL}/assets/${editingAssetId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify(asset)
                        });
                        const updated = await resp.json();
                        if (!resp.ok) throw new Error(updated.message || 'Update failed');
                        replaceRowWithAsset(updated);
                    } catch (err) {
                        console.error('Update error', err);
                        alert('Failed to update asset. See console for details.');
                    }
                } else {
                    // Create
                    try {
                        const resp = await fetch(`${API_URL}/assets`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify(asset)
                        });
                        const created = await resp.json();
                        if (!resp.ok) throw new Error(created.message || 'Create failed');
                        appendAssetRow(created);
                    } catch (err) {
                        console.error('Create error', err);
                        alert('Failed to create asset. See console for details.');
                    }
                }

                updateDashboardVisibility();
                closeModal();
            });

            function createTableRowHTML(asset) {
                return `
                    <td>
                        <div class="asset-name">${asset.name}</div>
                        <div class="asset-symbol" style="color:var(--text-secondary); font-size:0.9rem;">${asset.type}</div>
                    </td>
                    <td>${asset.quantity}</td>
                    <td>$${parseFloat(asset.price).toFixed(2)}</td>
                    <td>
                        <button class="action-btn edit">Edit</button>
                        <button class="action-btn delete">Delete</button>
                    </td>
                `;
            }

            function appendAssetRow(asset) {
                const newRow = document.createElement('tr');
                const id = asset.id || asset._id || ''; 
                newRow.setAttribute('data-id', id);
                newRow.innerHTML = createTableRowHTML(asset);
                assetsTableBody.appendChild(newRow);
            }

            function replaceRowWithAsset(asset) {
                const id = asset.id || asset._id || '';
                const row = assetsTableBody.querySelector(`tr[data-id="${id}"]`);
                if (row) row.innerHTML = createTableRowHTML(asset);
            }

            function updateDashboardVisibility() {
                const hasAssets = assetsTableBody.children.length > 0;
                if(hasAssets) {
                    emptyState.classList.add('hidden');
                    assetsTable.classList.remove('hidden');
                    statsGrid.classList.remove('hidden');
                    insightsGrid.classList.remove('hidden');
                } else {
                    emptyState.classList.remove('hidden');
                    assetsTable.classList.add('hidden');
                    statsGrid.classList.add('hidden');
                    insightsGrid.classList.add('hidden');
                }
            }

            assetsTableBody.addEventListener('click', function(event) {
                const target = event.target;
                const row = target.closest('tr');
                if (!row) return;
                const id = row.getAttribute('data-id');

                if (target.classList.contains('edit')) {
                    openEditForAsset(id);
                } else if (target.classList.contains('delete')) {
                    deletingAssetId = id;
                    deleteConfirmModal.classList.add('active');
                }
            });

            async function openEditForAsset(id) {
                try {
                    const resp = await fetch(`${API_URL}/assets`, {
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const list = await resp.json();
                    const asset = list.find(a => (a.id === id) || (a._id === id) || (a._id && a._id.toString() === id));
                    if (!asset) {
                        alert('Asset not found');
                        return;
                    }
                    openModal('edit', { id: id, type: asset.type, name: asset.name, quantity: asset.quantity, price: asset.price });
                } catch (err) {
                    console.error('Fetch asset for edit error', err);
                    alert('Failed to fetch asset for edit. See console.');
                }
            }

            // Load initial assets
            async function loadAssets() {
                try {
                    const resp = await fetch(`${API_URL}/assets`, {
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!resp.ok) throw new Error('Failed to fetch assets');
                    const assets = await resp.json();
                    assetsTableBody.innerHTML = '';
                    assets.forEach(a => appendAssetRow(a));
                    updateDashboardVisibility();
                } catch (err) {
                    console.error('Load assets error', err);
                    alert('Could not load assets. Please check console and ensure backend is running.');
                }
            }
            await loadAssets();
        });