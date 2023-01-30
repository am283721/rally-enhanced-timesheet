Ext.override(Rally.ui.grid.plugin.Validation, {
  _onBeforeEdit: function () {
    // clear this because it won't let us do the getEditor on cells
  }
});

Ext.define('CA.techservices.TimeTable', {
  extend: 'Ext.Container',
  alias: 'widget.tstimetable',
  rows: [],
  cls: 'tstimetable',

  time_entry_item_fetch: [
    'WeekStartDate',
    'WorkProductDisplayString',
    'WorkProduct',
    'Task',
    'TaskDisplayString',
    'PortfolioItem',
    'Project',
    'ObjectID',
    'Name',
    'Release',
    'ReleaseDate',
    'FormattedID',
    'Iteration',
    'ToDo',
    'State',
    'Rank',
    'Defect',
    'Estimate',
    'Priority',
    'c_Priority'
  ],

  config: {
    startDate: null,
    editable: true,
    timesheetUser: null,
    hasItemsInPastReleases: false,
    pinKey: 'CA.techservices.timesheet.pin',
    showEditTimeDetailsMenuItem: false,
    pickableColumns: null,
    maxRows: null,
    /* String -- put in the lowest level PI Name (field name on a story) so we can trace up to a PI */
    lowestLevelPIName: null
  },

  constructor: function (config) {
    this.mergeConfig(config);

    if (Ext.isEmpty(config.startDate) || !Ext.isDate(config.startDate)) {
      throw 'CA.techservices.TimeTable requires startDate parameter (JavaScript Date)';
    }

    this.weekStart = CA.techservices.timesheet.TimeRowUtils.getDayOfWeekFromDate(this.startDate) || 0;
    this.callParent([this.config]);
  },

  initComponent: function () {
    this.callParent(arguments);

    this.addEvents(
      /**
       * @event
       * Fires when the grid has been rendered
       * @param {CA.techservices.TimeTable } this
       * @param {Rally.ui.grid.Grid} grid
       */
      'gridReady'
    );

    if (Ext.isEmpty(this.timesheetUser)) {
      this.timesheetUser = Rally.getApp().getCurrentUser();
    }
    // shift start date
    this.startDate = TSDateUtils.pretendIMeantUTC(this.startDate);

    if (!Ext.isEmpty(this.lowestLevelPIName)) {
      this.time_entry_item_fetch.push(this.lowestLevelPIName);
    }

    TSUtilities.fetchField('Task', 'State').then({
      success: function (field) {
        this.taskState = field;
        this._updateData();
      },
      failure: function (msg) {
        Ext.Msg.alert('Problem Initiating TimeSheet App', msg);
      },
      scope: this
    });
  },

  _updateData: function () {
    this.setLoading('Loading time...');
    let me = this;
    me.maxRows = 48;

    Deft.Chain.sequence([this._loadTimeEntryItems, this._loadTimeEntryValues, this._loadTimeDetailPreferences, this._loadDefaultSettings], this).then({
      scope: this,
      success: function (results) {
        let time_entry_items = results[0];
        let time_entry_values = results[1];
        let time_detail_prefs = results[2];
        this.time_entry_defaults = results[3];

        this.rows = this._createRows(time_entry_items, time_entry_values, time_detail_prefs);
        this._makeGrid(this.rows);
        this.setLoading(false);
      },
      failure: function (msg) {
        Ext.Msg.alert('Problem Loading', msg);
      }
    });
  },

  _loadDefaultSettings: function () {
    let deferred = Ext.create('Deft.Deferred');

    Rally.data.PreferenceManager.load({
      filterByUser: this.timesheetUser._ref,
      additionalFilters: [{ property: 'Name', operator: 'contains', value: this.pinKey }],

      success: function (prefs) {
        //process prefs
        let defaults = {};
        Ext.Object.each(prefs, function (key, pref) {
          let value = Ext.JSON.decode(pref);
          Ext.apply(defaults, value);
        });

        deferred.resolve(defaults);
      }
    });
    return deferred.promise;
  },

  _makeGrid: function (rows) {
    this.removeAll();
    let me = this;
    let table_store = Ext.create('Rally.data.custom.Store', {
      model: 'CA.techservices.timesheet.TimeRow',
      data: rows,
      pageSize: me.maxRows,
      remoteSort: false,
      sortOnFither: true,
      sortOnLoad: true,
      sorters: [{ property: this.sortedColumn, direction: this.sortDirection }]
    });

    this.grid = this.add({
      xtype: 'rallygrid',
      store: table_store,
      columnCfgs: this._getColumns(),
      showPagingToolbar: false,
      showRowActionsColumn: false,
      disableSelection: true,
      enableColumnMove: false,
      enableColumnResize: false,
      features: [
        {
          ftype: 'summary',
          dock: 'top'
        }
      ],
      listeners: {
        sortchange: function (ct, column, direction) {
          this.sortedColumn = column.dataIndex;
          this.sortDirection = direction;
          me.fireEvent('sortchange', this, column.dataIndex, direction);
        },
        viewready: function () {
          me.addWarningIfPreviousWorkExists(me);
        }
      },
      viewConfig: {
        listeners: {
          itemupdate: function () {}
        }
      }
    });

    this.fireEvent('gridReady', this, this.grid);
  },

  _getRowActions: function (record) {
    //
    let me = this;

    let actions = [
      {
        xtype: 'rallyrecordmenuitem',
        text: 'Set as Default',
        predicate: function () {
          return !this.record.isPinned();
        },
        handler: function (menu) {
          me._pinRecord(menu.record);
        },
        record: record
      },
      {
        xtype: 'rallyrecordmenuitem',
        text: 'Unset Default',
        predicate: function () {
          return this.record.isPinned();
        },
        handler: function (menu) {
          me._unpinRecord(menu.record);
        },
        record: record
      },
      {
        xtype: 'rallyrecordmenuitem',
        text: 'Clear',
        record: record,
        predicate: function () {
          return me.editable;
        },
        handler: function (menu) {
          let row = menu.record;
          if (0 < row.get('Total')) {
            Ext.MessageBox.confirm('Clear Row', 'You have hours entered for this row. Are you sure?', function (res) {
              if ('yes' === res) {
                Ext.Array.remove(me.rows, row);
                row.clearAndRemove();
              }
            });
          } else {
            Ext.Array.remove(me.rows, row);
            row.clearAndRemove();
          }
        }
      }
    ];

    if (me.showEditTimeDetailsMenuItem) {
      actions.push({
        xtype: 'rallyrecordmenuitem',
        text: 'Edit Time',
        record: record,
        handler: function (menu) {
          let row = menu.record;
          me._launchTimeDetailsDialog(row);
        }
      });
    }
    return actions;
  },

  setPickableColumns: function (pickable_columns) {
    let columns = Ext.Array.merge([], this._getBaseLeftColumns());
    columns = Ext.Array.merge(columns, pickable_columns);
    columns = Ext.Array.merge(columns, this._getBaseRightColumns());

    let store = this.getGrid().getStore();
    this.getGrid().reconfigure(store, columns);
  },

  _getColumns: function () {
    let columns = Ext.Array.merge([], this._getBaseLeftColumns());

    columns = Ext.Array.merge(columns, this.getPickableColumns());

    columns = Ext.Array.merge(columns, this._getBaseRightColumns());

    return columns;
  },

  getRankValue: function (record, gridStore) {
    let store = (gridStore && gridStore.treeStore) || gridStore,
      sorters = store && store.getSorters(),
      sorter = sorters && sorters[1];

    if (sorter && Rally.data.Ranker.isRankField(sorter.property)) {
      let index = store.indexOf(record);
      if (index !== -1) {
        let currentPage = store.currentPage ? store.currentPage : 1;
        let offset = store.pageSize * (currentPage - 1);

        return sorter.direction === 'ASC' ? index + offset + 1 : store.getTotalCount() - offset - index;
      }
    }
    return '';
  },

  getPickableColumns: function () {
    let columns = [],
      me = this;

    columns.push({
      dataIndex: 'Project',
      text: 'Project',
      flex: 1,
      editor: null,
      sortable: true,
      hidden: false,
      menuDisabled: true,
      renderer: function (value, meta, record) {
        if (value < 0) {
          return '--';
        }
        return record.get('Project').Name;
      }
    });

    columns.push({
      dataIndex: 'WorkProductOID',
      text: 'Work Item',
      flex: 1,
      editor: null,
      sortable: true,
      menuDisabled: true,
      renderer: function (value, meta, record) {
        if (value < 0) {
          return '--';
        }
        return Ext.String.format(
          "<a target='_top' href='{0}'>{1}</a>: {2}",
          Rally.nav.Manager.getDetailUrl(record.get('WorkProduct')),
          record.get('WorkProduct').FormattedID,
          record.get('WorkProduct').Name
        );
      }
    });

    columns.push({
      dataIndex: 'WorkProductFID',
      text: 'Work Item ID',
      flex: 1,
      editor: null,
      hidden: true,
      menuDisabled: true,
      sortable: true,
      renderer: function (value, meta, record) {
        if (value < 0) {
          return '--';
        }
        return Ext.String.format("<a target='_top' href='{0}'>{1}</a>", Rally.nav.Manager.getDetailUrl(record.get('WorkProduct')), record.get('WorkProduct').FormattedID);
      }
    });

    columns.push({
      dataIndex: 'WorkProductName',
      text: 'Work Item Name',
      hidden: true,
      flex: 1,
      editor: null,
      menuDisabled: true,
      sortable: true
    });

    let d_state_config = {
      dataIndex: 'WorkProductState',
      text: 'Defect State',
      sortable: true,
      field: 'WorkProduct',
      menuDisabled: true,

      getEditor: function (record) {
        if (record.get('WorkProduct')._type !== 'Defect') {
          return false;
        }

        return Ext.create('Ext.grid.CellEditor', {
          field: Ext.create('Rally.ui.combobox.FieldValueComboBox', {
            xtype: 'rallyfieldvaluecombobox',
            model: 'Defect',
            field: 'State',
            value: record.get('WorkProduct').State,
            listeners: {
              change: function (field, new_value) {
                if (Ext.isEmpty(new_value)) {
                  return;
                }
                record.set('WorkProduct'.State, new_value);
                record.save();
              }
            }
          })
        });
      }
    };

    columns.push(d_state_config);

    if (Ext.isEmpty(this.lowestLevelPIName)) {
      columns.push({
        dataIndex: 'PortfolioItemOID',
        text: 'Portfolio Item',
        flex: 1,
        editor: null,
        sortable: true,
        hidden: true,
        menuDisabled: true,
        renderer: function (value, meta, record) {
          if (value < 0) {
            return '--';
          }
          return Ext.String.format(
            "<a target='_top' href='{0}'>{1}</a>: {2}",
            Rally.nav.Manager.getDetailUrl(record.get('PortfolioItem')),
            record.get('PortfolioItem').FormattedID,
            record.get('PortfolioItem').Name
          );
        }
      });

      columns.push({
        dataIndex: 'PortfolioItemFID',
        text: 'Portfolio Item ID',
        flex: 1,
        editor: null,
        hidden: true,
        menuDisabled: true,
        sortable: true,
        renderer: function (value, meta, record) {
          if (value < 0) {
            return '--';
          }
          return Ext.String.format("<a target='_top' href='{0}'>{1}</a>", Rally.nav.Manager.getDetailUrl(record.get('PortfolioItem')), record.get('PortfolioItem').FormattedID);
        }
      });

      columns.push({
        dataIndex: 'PortfolioItemName',
        text: 'PortfolioItem Name',
        hidden: true,
        flex: 1,
        editor: null,
        menuDisabled: true,
        sortable: true
      });
    } else {
      columns.push({
        dataIndex: 'PortfolioItemOID',
        text: this.lowestLevelPIName,
        flex: 1,
        editor: null,
        sortable: true,
        hidden: true,
        menuDisabled: true,
        renderer: function (value, meta, record) {
          if (value < 0) {
            return '--';
          }
          return Ext.String.format(
            "<a target='_top' href='{0}'>{1}</a>: {2}",
            Rally.nav.Manager.getDetailUrl(record.get('PortfolioItem')),
            record.get('PortfolioItem').FormattedID,
            record.get('PortfolioItem').Name
          );
        }
      });

      columns.push({
        dataIndex: 'PortfolioItemFID',
        text: this.lowestLevelPIName + ' ID',
        flex: 1,
        editor: null,
        hidden: true,
        menuDisabled: true,
        sortable: true,
        renderer: function (value, meta, record) {
          if (value < 0) {
            return '--';
          }
          return Ext.String.format("<a target='_top' href='{0}'>{1}</a>", Rally.nav.Manager.getDetailUrl(record.get('PortfolioItem')), record.get('PortfolioItem').FormattedID);
        }
      });

      columns.push({
        dataIndex: 'PortfolioItemName',
        text: this.lowestLevelPIName + ' Name',
        hidden: true,
        flex: 1,
        editor: null,
        menuDisabled: true,
        sortable: true
      });
    }

    columns.push({
      dataIndex: 'Release',
      text: 'Release',
      width: 150,
      editor: null,
      sortable: false,
      menuDisabled: true,
      renderer: function (value) {
        if (Ext.isEmpty(value)) {
          return '--';
        }
        return value._refObjectName;
      }
    });

    columns.push({
      dataIndex: 'Iteration',
      text: 'Iteration',
      width: 150,
      editor: null,
      sortable: false,
      menuDisabled: true,
      renderer: function (value) {
        if (Ext.isEmpty(value)) {
          return '--';
        }
        return value._refObjectName;
      }
    });

    columns.push({
      dataIndex: 'TaskOID',
      text: 'Task',
      sortable: true,
      flex: 1,
      menuDisabled: true,
      editor: null,
      renderer: function (value, meta, record) {
        if (value < 0) {
          return '--';
        }
        return Ext.String.format("<a target='_top' href='{0}'>{1}</a>: {2}", Rally.nav.Manager.getDetailUrl(record.get('Task')), record.get('Task').FormattedID, record.get('Task').Name);
      }
    });

    columns.push({
      dataIndex: 'TaskFID',
      text: 'Task ID',
      sortable: true,
      flex: 1,
      hidden: true,
      menuDisabled: true,
      editor: null,
      renderer: function (value, meta, record) {
        if (value < 0) {
          return '--';
        }
        return Ext.String.format("<a target='_top' href='{0}'>{1}</a>", Rally.nav.Manager.getDetailUrl(record.get('Task')), record.get('Task').FormattedID);
      }
    });

    columns.push({
      dataIndex: 'TaskName',
      text: 'Task Name',
      sortable: true,
      flex: 1,
      hidden: true,
      menuDisabled: true,
      editor: null
    });

    let state_config = {
      dataIndex: 'State',
      text: 'State',
      resizable: false,
      align: 'left',
      field: 'test',
      sortable: true,
      menuDisabled: true,

      getEditor: function (record) {
        if (Ext.isEmpty(record.get('Task'))) {
          return false;
        }

        return Ext.create('Ext.grid.CellEditor', {
          field: Ext.create('Rally.ui.combobox.FieldValueComboBox', {
            xtype: 'rallyfieldvaluecombobox',
            model: 'Task',
            field: 'State',
            value: record.get('Task').State,
            listeners: {
              change: function (field, new_value) {
                if (Ext.isEmpty(new_value)) {
                  return;
                }
                record.set('State', new_value);
                record.save();
              }
            }
          })
        });
      },
      renderer: function (value, metaData, record) {
        if (Ext.isEmpty(record.get('Task'))) {
          return '--';
        }
        let tpl = Ext.create('Rally.ui.renderer.template.ScheduleStateTemplate', { field: me.taskState });
        return tpl.apply(record.get('Task'));
      }
    };

    columns.push(state_config);

    let todo_config = {
      dataIndex: 'ToDo',
      text: 'To Do',
      width: 50,
      resizable: false,
      align: 'center',
      field: 'test',
      sortable: true,
      menuDisabled: true,
      summaryType: 'sum',
      getEditor: function (record) {
        if (Ext.isEmpty(record.get('Task'))) {
          return false;
        }
        let minValue = 0;
        return Ext.create('Ext.grid.CellEditor', {
          field: Ext.create('Rally.ui.NumberField', {
            xtype: 'rallynumberfield',
            minValue: minValue,
            selectOnFocus: true,
            listeners: {
              change: function (field, new_value) {
                if (Ext.isEmpty(new_value)) {
                  field.setValue(0);
                }
                record.set('ToDo', new_value);
                record.save();
              }
            }
          })
        });
      },
      renderer: function (value, meta) {
        meta.tdCls = 'ts-right-border';
        return value > 0 ? value : '';
      }
    };

    columns.push(todo_config);

    if (!this.pickableColumns) {
      return columns;
    }

    let pickable_by_index = {};
    Ext.Array.each(this.pickableColumns, function (column) {
      pickable_by_index[column.dataIndex] = column;
    });

    return Ext.Array.map(columns, function (column) {
      let pickable = pickable_by_index[column.dataIndex];
      if (Ext.isEmpty(pickable)) {
        return column;
      }

      if (pickable.hidden) {
        column.hidden = true;
      } else {
        column.hidden = false;
      }
      return column;
    });
  },

  _getBaseLeftColumns: function () {
    let me = this;

    let columns = [
      {
        xtype: 'rallyrowactioncolumn',
        sortable: false,
        scope: me,
        rowActionsFn: function (record) {
          return me._getRowActions(record);
        }
      },
      {
        text: ' ',
        width: 25,
        dataIndex: '__SecretKey',
        renderer: function (value, meta, record) {
          let icons = '';

          if (record.hasOpenDetails()) {
            icons = icons + "<span class='icon-calendar'></span>";
          }
          return icons;
        }
      }
    ];

    return columns;
  },

  _getBaseRightColumns: function () {
    let columns = [];

    Ext.Array.each(
      CA.techservices.timesheet.TimeRowUtils.getOrderedDaysBasedOnWeekStart(this.weekStart),
      function (day, idx) {
        columns.push(this._getColumnForDay(day, idx));
      },
      this
    );

    let total_renderer = function (value, meta) {
      meta.tdCls = 'ts-total-cell';
      return value;
    };

    columns.push({
      dataIndex: 'Total',
      text: 'Total',
      width: 50,
      resizable: false,
      align: 'center',
      editor: null,
      summaryType: 'sum',
      renderer: total_renderer
    });

    return columns;
  },

  _getItemOIDFromRow: function (record) {
    let record_item = record.get('Task') || record.get('WorkProduct');
    let oid = record_item.ObjectID;
    return oid;
  },

  _unpinRecord: function (record) {
    record.set('Pinned', false);
    let oid = this._getItemOIDFromRow(record);
    let key = Ext.String.format('{0}.{1}', this.pinKey, oid);

    let settings = {};
    let value = {};
    value[oid] = false;

    settings[key] = Ext.JSON.encode(value);

    Rally.data.PreferenceManager.update({
      user: this.timesheetUser.ObjectID,
      filterByUser: this.timesheetUser._ref,
      settings: settings
    });
  },

  _pinRecord: function (record) {
    record.set('Pinned', true);
    let record_item = record.get('Task') || record.get('WorkProduct');
    let oid = this._getItemOIDFromRow(record);
    let key = Ext.String.format('{0}.{1}', this.pinKey, oid);

    let settings = {};
    let value = {};
    value[oid] = record_item._type;

    settings[key] = Ext.JSON.encode(value);

    Rally.data.PreferenceManager.update({
      user: this.timesheetUser.ObjectID,
      filterByUser: this.timesheetUser._ref,
      settings: settings
    });
  },

  _getColumnForDay: function (day, idx) {
    let me = this;
    let today = new Date();
    let end_date = Rally.util.DateTime.add(this.startDate, 'week', 1);
    let indexToday = today.getDay();
    let weekdays = CA.techservices.timesheet.TimeRowUtils.getOrderedDaysBasedOnWeekStart(0);
    let moment_utc_start = moment(this.startDate).utc();
    let moment_utc_days_later = moment_utc_start.add(idx, 'day').utc();
    let currentDayPlusPadding = Rally.util.DateTime.add(moment_utc_days_later.toDate(), 'hour', 12);
    let header_text = Ext.String.format('{0}<br/>{1}', CA.techservices.timesheet.TimeRowUtils.dayShortNames[day], moment_utc_days_later.format('D MMM'));

    const shouldDisableCell = (release) => {
      return release && release.ReleaseDate && new Date(release.ReleaseDate) < currentDayPlusPadding && !Rally.getApp().isTimeSheetAdmin();
    };

    let editor_config = function (record) {
      const release = (record.get && record.get('Release')) || record.Release;
      let minValue = 0;
      return Ext.create('Ext.grid.CellEditor', {
        field: Ext.create('Rally.ui.NumberField', {
          minValue,
          maxValue: 36,
          disabled: !me.editable || shouldDisableCell(release),
          selectOnFocus: true
        }),
        listeners: {
          complete: function (field, new_value) {
            if (Ext.isEmpty(new_value)) {
              new_value = 0;
              field.setValue(new_value);
            }
            record.set(day, new_value);
            record.save();
          }
        }
      });
    };

    let config = {
      dataIndex: day,
      html: header_text,
      width: 50,
      resizable: false,
      sortable: true,
      align: 'center',
      getEditor: editor_config,
      field: 'test',
      summaryType: 'sum',
      renderer: function (value, meta, record) {
        const release = (record.get && record.get('Release')) || record.Release;

        if (shouldDisableCell(release)) {
          meta.tdCls = 'ts-disabled-cell';
          me.hasItemsInPastReleases = true;
        }

        if (value === 0) {
          return '';
        }
        return value;
      },
      summaryRenderer: function (value) {
        if (value === 0) {
          return '';
        }
        return Ext.util.Format.number(value, '0.00');
      }
    };

    //Highlight today
    if (day === weekdays[indexToday] && this.startDate < today && today < end_date) {
      config.renderer = function (value, meta, record) {
        const release = (record.get && record.get('Release')) || record.Release;

        if (shouldDisableCell(release)) {
          meta.tdCls = 'ts-disabled-cell';
          me.hasItemsInPastReleases = true;
        } else {
          meta.tdCls = 'ts-total-cell';
        }

        if (value === 0) {
          return '';
        }
        return value;
      };
    }

    if (day === 'Saturday' || day === 'Sunday') {
      config.renderer = function (value, meta, record) {
        const release = (record.get && record.get('Release')) || record.Release;

        if (shouldDisableCell(release)) {
          meta.tdCls = 'ts-disabled-cell';
          me.hasItemsInPastReleases = true;
        } else {
          meta.tdCls = 'ts-weekend-cell';
        }

        if (value === 0) {
          return '';
        }
        return value;
      };
    } else if (!me.editable) {
      config.renderer = function (value, meta) {
        meta.tdCls = 'ts-disabled-cell';
        if (value === 0) {
          return '';
        }
        return value;
      };
    }

    return config;
  },

  _getTimeEntryItemSets: function (time_entry_items) {
    let time_entry_item_sets = {};
    Ext.Array.each(time_entry_items, function (item) {
      let oid = item.get('Task') && item.get('Task').ObjectID;
      if (Ext.isEmpty(oid)) {
        oid = item.get('WorkProduct') && item.get('WorkProduct').ObjectID;
      }
      if (Ext.isEmpty(oid)) {
        oid = item.get('Project') && item.get('Project').ObjectID;
      }

      if (Ext.isEmpty(time_entry_item_sets[oid])) {
        time_entry_item_sets[oid] = [];
      }
      time_entry_item_sets[oid].push(item);
    });

    return Ext.Object.getValues(time_entry_item_sets);
  },

  _createRows: function (time_entry_items, time_entry_values, time_detail_prefs) {
    let rows = [],
      me = this;
    // in Rally, a time row has to start on Sunday, so we'll have up to two
    // time entry items for every row if the week starts on a different day
    let time_entry_item_sets = this._getTimeEntryItemSets(time_entry_items);

    Ext.Array.each(time_entry_item_sets, function (item_set) {
      let item_values = [];

      Ext.Array.each(item_set, function (time_entry_item) {
        let oid = time_entry_item.get('ObjectID');
        let values_for_time_entry_item = Ext.Array.filter(time_entry_values, function (time_entry_value) {
          return time_entry_value.get('TimeEntryItem').ObjectID == oid;
        });

        item_values = Ext.Array.push(item_values, values_for_time_entry_item);
      });

      let item_oid = CA.techservices.timesheet.TimeRowUtils.getItemOIDFromTimeEntryItem(item_set[0]);
      let detail_preference = null;
      Ext.Array.each(time_detail_prefs, function (pref) {
        let name_array = pref.get('Name').split('.');
        if ('' + item_oid == name_array[name_array.length - 1]) {
          detail_preference = pref;
        }
      });

      // switch to Feature instead of PI (so it's not just direct kids)
      if (!Ext.isEmpty(me.lowestLevelPIName)) {
        Ext.Object.each(item_set, function (key, item) {
          if (item.get('WorkProduct') && item.get('WorkProduct')[me.lowestLevelPIName]) {
            let workproduct = item.get('WorkProduct');
            workproduct.PortfolioItem = item.get('WorkProduct')[me.lowestLevelPIName];
            item.set('WorkProduct', workproduct);
          }
        });
      }

      let config = {
        WeekStartDate: me.startDate,
        TimeEntryItemRecords: item_set,
        TimeEntryValueRecords: item_values
      };

      if (!Ext.isEmpty(detail_preference)) {
        config.DetailPreference = detail_preference;
      }
      if (me.time_entry_defaults[item_oid] && me.time_entry_defaults[item_oid] !== false) {
        config.Pinned = true;
      }

      let row = Ext.create('CA.techservices.timesheet.TimeRow', config);
      rows.push(row);
    });

    return rows;
  },

  addRowForItem: function (item) {
    let me = this;

    if (this._hasRowForItem(item)) {
      return;
    }

    let item_type = item.get('_type');
    let sunday_start = TSDateUtils.getBeginningOfWeekISOForLocalDate(me.startDate);

    let config = {
      WorkProduct: {
        _ref: item.get('_ref')
      },
      WeekStartDate: sunday_start
    };

    if (item.get('Project')) {
      config.Project = item.get('Project');
    }

    if (item_type === 'task') {
      config.Task = { _ref: item.get('_ref') };
      config.WorkProduct = { _ref: item.get('WorkProduct')._ref };
    }
    Rally.data.ModelFactory.getModel({
      type: 'TimeEntryItem',
      scope: this,
      success: function (model) {
        let tei = Ext.create(model, config);
        tei.save({
          fetch: me.time_entry_item_fetch,
          callback: function (result, operation, success) {
            if (!success) {
              Rally.getApp().showError(`Error creating Time Entry Item: ${operation.error?.errors?.join() || 'Unknown Error'}`);
              return;
            }

            let row = Ext.create('CA.techservices.timesheet.TimeRow', {
              WeekStartDate: me.startDate,
              TimeEntryItemRecords: [result],
              TimeEntryValueRecords: []
            });

            let item_oid = me._getItemOIDFromRow(row);
            if (me.time_entry_defaults[item_oid] && me.time_entry_defaults[item_oid] !== false) {
              row.set('Pinned', true);
            }
            me.grid.getStore().loadRecords([row], { addRecords: true });
            me.rows.push(row);
            me.grid.refresh();
            me.addWarningIfPreviousWorkExists(me);
          }
        });
      }
    });
  },

  getGrid: function () {
    return this.grid;
  },

  _hasRowForItem: function (item) {
    let rows = this.rows;
    let hasRow = false;
    let item_type = item.get('_type');

    Ext.Array.each(rows, function (row) {
      if (row) {
        if (item_type === 'task') {
          if (row.get('Task') && row.get('Task')._ref === item.get('_ref')) {
            hasRow = true;
          }
        } else {
          if (Ext.isEmpty(row.get('Task')) && row.get('WorkProduct') && row.get('WorkProduct')._ref === item.get('_ref')) {
            hasRow = true;
          }
        }
      }
    });

    return hasRow;
  },

  _launchTimeDetailsDialog: function (row) {
    Ext.create('CA.technicalservices.TimeDetailsDialog', {
      row: row
    });
  },

  _loadTimeEntryItems: function () {
    this.setLoading('Loading time entry items...');

    let filters = [{ property: 'User.ObjectID', value: this.timesheetUser.ObjectID }];

    if (this.weekStart === 0) {
      filters.push({ property: 'WeekStartDate', value: this.startDate });
    } else {
      filters.push({ property: 'WeekStartDate', operator: '>=', value: Rally.util.DateTime.add(this.startDate, 'day', -6) });
      filters.push({ property: 'WeekStartDate', operator: '<=', value: Rally.util.DateTime.add(this.startDate, 'day', 6) });
    }
    let config = {
      model: 'TimeEntryItem',
      context: {
        project: null
      },
      fetch: this.time_entry_item_fetch,
      enableRankFieldParameterAutoMapping: false,
      filters: filters,
      sorters: [{ property: 'ProjectDisplayString', direction: 'ASC' }],
      limit: this.maxRows * 2,
      pageSize: this.maxRows * 2
    };

    return TSUtilities.loadWsapiRecords(config);
  },

  _loadTimeEntryValues: function () {
    this.setLoading('Loading time entry values...');

    let filters = [{ property: 'TimeEntryItem.User.ObjectID', value: this.timesheetUser.ObjectID }];

    if (this.weekStart === 0) {
      filters.push({ property: 'TimeEntryItem.WeekStartDate', value: this.startDate });
    } else {
      filters.push({ property: 'TimeEntryItem.WeekStartDate', operator: '>=', value: Rally.util.DateTime.add(this.startDate, 'day', -6) });
      filters.push({ property: 'TimeEntryItem.WeekStartDate', operator: '<=', value: Rally.util.DateTime.add(this.startDate, 'day', 6) });
    }

    let config = {
      model: 'TimeEntryValue',
      context: {
        project: null
      },
      fetch: ['DateVal', 'Hours', 'TimeEntryItem', 'ObjectID'],
      filters: filters,
      pageSize: 2000,
      limit: 'Infinity'
    };

    return TSUtilities.loadWsapiRecords(config);
  },

  _loadTimeDetailPreferences: function () {
    this.setLoading('Loading time entry details...');

    let filters = [{ property: 'Name', operator: 'contains', value: CA.techservices.timesheet.TimeRowUtils.getDetailPrefix(this.startDate) }];

    let config = {
      model: 'Preference',
      fetch: ['Name', 'Value'],
      filters: filters,
      context: {
        project: null
      }
    };

    return TSUtilities.loadWsapiRecords(config);
  },

  addWarningIfPreviousWorkExists(table) {
    if (table.hasItemsInPastReleases && table.editable) {
      const app = Rally.getApp();
      const messageContainer = app.down('#messageContainer');
      const supportEmail = app.getSetting('timesheetSupportEmail');

      if (messageContainer) {
        let msg = 'One or more rows contains work assigned to a past release and cannot be edited past its release date';

        if (supportEmail) {
          msg += `. For timesheet adjustments, please contact ${supportEmail}`;
        }

        messageContainer.update({ msg });
      }
    }
  }
});
