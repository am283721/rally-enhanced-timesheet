/**
 * A dialog that displays artifacts to choose from
 *
 */
Ext.define('Rally.technicalservices.ChooserDialog', {
  extend: 'Rally.ui.dialog.Dialog',
  alias: 'widget.tschooserdialog',

  clientMetrics: [
    {
      beginEvent: 'beforeshow',
      endEvent: 'show',
      description: 'dialog shown'
    }
  ],

  width: 800,
  maxHeight: '100%',
  closable: true,

  searchContext: 'project',

  config: {
    /**
     * @cfg {String}
     * Title to give to the dialog
     */
    title: 'Choose an Artifact',
    /**
     * @cfg {Array} (required)
     * List of artifact types to allow the user to choose from
     */
    artifactTypes: [],
    /**
     * @cfg {Boolean}
     * Allow multiple selection or not
     */
    multiple: false,

    /**
     * @cfg {Object}
     * An {Ext.data.Store} config object used when building the grid
     * Handy when you need to limit the selection with store filters
     */
    storeConfig: {},

    /**
     * @cfg {Object}
     * The list of filter configs that will appear in the filter combobox
     * Each list element should include a displayName and an attributeName property,
     * where the attributeName is the name of wsapi queryable attribute:
     *     {
     *         displayName: 'Formatted ID',
     *         attributeName: 'FormattedID'
     *     }
     */
    filterableFields: [],

    /**
     * @cfg {Ext.grid.Column}
     * List of columns that will be used in the chooser
     */
    columns: [],

    /**
     * @cfg [{String}]
     * List of field names to fetch when getting the objects
     */
    fetchFields: [],

    /**
     * @cfg {String}
     * Text to be displayed on the button when selection is complete
     */
    selectionButtonText: 'Done',

    /**
     * @cfg {Object}
     * The grid configuration to be used when creative the grid of items in the dialog
     */
    gridConfig: {},

    /**
     * @cfg {String}
     * The ref of a record to select when the chooser loads
     */
    selectedRef: undefined

    /**
     * @private
     * @cfg userAction {String} (Optional)
     * The client metrics action to record when the user makes a selection and clicks done
     */
  },

  items: {
    xtype: 'panel',
    border: false,
    items: [
      {
        xtype: 'container',
        itemId: 'gridContainer',
        layout: 'fit',
        height: 400
      }
    ]
  },

  constructor: function (config) {
    this.mergeConfig(config);

    this.callParent([this.config]);
  },

  initComponent: function () {
    this.callParent(arguments);
    this.addEvents(
      /**
       * @event artifactChosen
       * Fires when user clicks done after choosing an artifact
       * @param {Rally.technicalservices.ChooserDialog} this dialog
       * @param {Rally.domain.WsapiModel} selected record or an array of selected records if multiple is true
       */
      'artifactChosen'
    );

    this.addCls('chooserDialog');

    this._buildButtons();
    this._buildSearchBar();

    Rally.data.ModelFactory.getModels({
      types: this.artifactTypes,
      success: function (models) {
        this.models = models;

        if (this.artifactTypes.length > 1) {
          this._setupComboBox(models);
        }

        this._buildGrid(models[this.artifactTypes[0]]);
      },
      scope: this
    });
  },

  /**
   * @private
   */
  _buildButtons: function () {
    this.down('panel').addDocked({
      xtype: 'toolbar',
      dock: 'bottom',
      padding: '0 0 10 0',
      layout: {
        type: 'hbox',
        pack: 'center'
      },
      ui: 'footer',
      items: [
        {
          xtype: 'rallybutton',
          text: this.selectionButtonText,
          cls: 'primary small',
          scope: this,
          userAction: 'clicked done in dialog',
          handler: function () {
            let selectedRecords = this._getSelectedRecords();
            if (!this.multiple) {
              selectedRecords = selectedRecords[0];
            }
            this.fireEvent('artifactChosen', this, selectedRecords);
            this.close();
          }
        },
        {
          xtype: 'rallybutton',
          text: 'Cancel',
          cls: 'secondary small',
          handler: this.close,
          scope: this,
          ui: 'link'
        }
      ]
    });
  },

  /**
   * @private
   */
  _buildSearchBar: function () {
    let filterTypeComboBox = Ext.create('Ext.form.field.ComboBox', {
      itemId: 'filterTypeComboBox',
      queryMode: 'local',
      store: Ext.create('Ext.data.Store', {
        fields: ['attributeName', 'displayName'],
        data: this.filterableFields
      }),
      displayField: 'displayName',
      valueField: 'attributeName',
      editable: false
    });

    filterTypeComboBox.select(filterTypeComboBox.getStore().getAt(1));

    this.addDocked({
      xtype: 'toolbar',
      itemId: 'searchBar',
      dock: 'top',
      items: [
        filterTypeComboBox,
        {
          xtype: 'textfield',
          itemId: 'searchTerms',
          emptyText: 'enter search terms',
          flex: 1,
          enableKeyEvents: true,
          listeners: {
            keyup: function (textField, event) {
              if (event.getKey() === Ext.EventObject.ENTER) {
                this._search();
              }
            },
            scope: this
          }
        },
        {
          xtype: 'button',
          text: '<span class="icon-search"> </span>',
          handler: this._openSearchMenu,
          scope: this
        }
      ]
    });

    filterTypeComboBox.on('change', this._changeSearchField, this);
  },

  _changeSearchField: function (field_combobox) {
    let field_name = field_combobox.getValue();

    let search_config = {
      itemId: 'searchTerms',
      emptyText: 'enter search terms',
      flex: 1
    };

    let field = this.models[this.artifactTypes[0]].getField(field_name);

    let editor_config = {
      xtype: 'textfield',
      enableKeyEvents: true,
      listeners: {
        keyup: function (textField, event) {
          if (event.getKey() === Ext.EventObject.ENTER) {
            this._search();
          }
        },
        scope: this
      }
    };

    if (field && field.editor && field.editor.field) {
      editor_config = field.editor.field;

      // for timeboxes to load:
      delete editor_config.storeConfig;
      editor_config.defaultToCurrentTimebox = true;
      editor_config.autoSelectCurrentItem = true;

      if (editor_config.xtype == 'rallytextfield') {
        editor_config.enableKeyEvents = true;
        editor_config.listeners = {
          keyup: function (textField, event) {
            if (event.getKey() === Ext.EventObject.ENTER) {
              this._search();
            }
          },
          scope: this
        };
      } else {
        editor_config.listeners = {
          scope: this,
          change: this._search,
          select: this._search
        };
      }
    }

    let config = Ext.Object.merge(search_config, editor_config);

    let index = this.down('#searchBar').items.length - 2;
    this.down('#searchTerms') && this.down('#searchTerms').destroy();
    this.down('#searchBar').insert(index, config);
  },

  /**
   * @private
   * @param {Object} models Object with {Rally.domain.WsapiModel} items
   *
   */
  _setupComboBox: function (models) {
    let searchBar = this.down('#searchBar');
    let combo = Ext.create('Ext.form.field.ComboBox', {
      xtype: 'combo',
      name: 'filterType',
      queryMode: 'local',
      store: Ext.create('Ext.data.Store', {
        fields: ['typeName', 'displayName', 'wsapiModel']
      }),
      displayField: 'displayName',
      valueField: 'typeName',
      editable: false
    });
    searchBar.insert(0, combo);

    Ext.Object.each(
      models,
      function (key, model) {
        combo.getStore().add({
          typeName: model.typePath,
          displayName: model.displayName,
          wsapiModel: model
        });
      },
      this
    );

    combo.select(combo.getStore().getAt(0));

    combo.on(
      'select',
      function (comboBox, options) {
        let option = options[0];
        this.grid.reconfigureWithModel(option.get('wsapiModel'));
      },
      this
    );
  },

  /**
   * @private
   * @param {Rally.domain.WsapiModel}
   *
   */
  _buildGrid: function (model) {
    let mode = this.multiple ? 'MULTI' : 'SINGLE';
    this.selectionModel = Ext.create('Rally.ui.selection.CheckboxModel', {
      mode: mode,
      allowDeselect: true
    });

    let store_config = this.storeConfig;
    store_config.context = { project: Rally.getApp().getContext().getProjectRef() };

    let new_fetch = Ext.Array.merge(['ObjectID'], this.fetchFields);
    let current_fetch = store_config.fetch || [];

    store_config.fetch = Ext.Array.merge(new_fetch, current_fetch);

    let gridConfig = Ext.Object.merge(
      {
        model: model,
        selModel: this.selectionModel,
        autoAddAllModelFieldsAsColumns: false,
        enableEditing: false,
        enableColumnHide: false,
        enableColumnMove: false,
        columnCfgs: this.columns,
        storeConfig: store_config,
        showRowActionsColumn: false,
        viewConfig: {
          emptyText: Rally.ui.EmptyTextFactory.get('defaultText')
        }
      },
      this.config.gridConfig
    );

    this.grid = Ext.create('Rally.ui.grid.Grid', gridConfig);
    this.mon(this.grid, 'load', this._onGridLoad, this);
    this.down('#gridContainer').add(this.grid);
    this._onGridReady();
  },

  _onGridReady: function () {
    if (!this.grid.rendered) {
      this.mon(this.grid, 'afterrender', this._onGridReady, this, { single: true });
      return;
    }

    if (this.grid.getStore().isLoading()) {
      this.mon(this.grid, 'load', this._onGridReady, this, { single: true });
      return;
    }

    this._onGridLoad();
    this.down('#gridContainer').setHeight(Math.min(Rally.getApp().getHeight() - 125, 400));
    this.center();

    if (Rally.BrowserTest) {
      Rally.BrowserTest.publishComponentReady(this);
    }
  },

  _onGridLoad: function () {
    if (this.getSelectedRef()) {
      let recordIndex = this.grid.getStore().find('_ref', this.getSelectedRef());
      if (recordIndex !== -1) {
        let record = this.grid.getStore().getAt(recordIndex);
        this.grid.getSelectionModel().select(record);
      }
    }
  },

  /**
   * @private
   * @return {Rally.data.Model}
   */
  _getSelectedRecords: function () {
    return this.selectionModel.getSelection();
  },

  /**
   * @private
   */
  _search: function () {
    let terms = this.down('#searchTerms').getValue();
    let filterBy = this.down('#filterTypeComboBox').getValue();
    let filter;

    let store_config = this.grid.storeConfig;

    store_config.context = { project: Rally.getApp().getContext().getProjectRef() };

    if (this.searchContext == 'workspace') {
      store_config.context = { project: null };
    }

    let store = this.grid.getStore();
    store.context = store_config.context;

    if (!Ext.isEmpty(terms)) {
      filter = Ext.create('Rally.data.wsapi.Filter', {
        property: filterBy,
        value: terms,
        operator: 'Contains'
      });
    }

    if (Ext.isFunction(this.down('#searchTerms').getQueryFromSelected)) {
      filter = this.down('#searchTerms').getQueryFromSelected();
    }

    this.grid.filter(filter, true);
  },

  _openSearchMenu: function (button) {
    let menu = Ext.widget({
      xtype: 'rallymenu',
      items: [
        {
          text: 'Search Selected Project',
          handler: function () {
            this.searchContext = 'project';
            this._search();
          },
          scope: this
        },
        {
          text: 'Search Everywhere',
          handler: function () {
            this.searchContext = 'workspace';
            this._search();
          },
          scope: this
        }
      ]
    });
    menu.showBy(button.getEl());
    if (button.toolTip) {
      button.toolTip.hide();
    }
  }
});
