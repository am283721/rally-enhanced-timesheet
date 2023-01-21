Ext.define('TSTimesheet', {
  extend: 'Rally.app.App',
  componentCls: 'app',
  defaults: { margin: 10 },
  layout: 'border',

  items: [{ xtype: 'container', itemId: 'selector_box', region: 'north', layout: { type: 'hbox' }, minHeight: 25 }],

  pickableColumns: null,
  sortedColumn: null,
  direction: '',
  portfolioItemTypes: [],
  stateful: true,
  stateEvents: ['columnschosen', 'columnmoved', 'columnresize', 'sortchange'],
  stateId: 'CA.technicalservices.timesheet.Settings.4',

  config: {
    defaultSettings: {
      /* 0=sunday, 6=saturday */
      weekStartsOn: 0,
      showAddMyStoriesButton: false,
      showEditTimeDetailsMenuItem: false,
      showTaskStateFilter: false
    }
  },

  async launch() {
    try {
      this.isTimeSheetAdmin = await TSUtilities.currentUserIsTimeSheetAdmin();
      this.portfolioItemTypes = await TSUtilities.fetchPortfolioItemTypes();
      this._addSelectors(this.down('#selector_box'));
    } catch (e) {
      this.showError(e, 'Problem Initiating TimeSheet App');
    }
  },

  _getLowestLevelPIName: function () {
    return this.portfolioItemTypes[0].get('Name');
  },

  _addSelectors: function (container) {
    container.removeAll();
    container.add({ xtype: 'container', itemId: 'add_button_box' });

    const adminContainer = container.add({ xtype: 'container', flex: 1, layout: { type: 'hbox', align: 'middle', pack: 'center' } });
    var week_starts_on = this.getSetting('weekStartsOn');

    if (this.isTimeSheetAdmin) {
      adminContainer.add({
        xtype: 'rallyusersearchcombobox',
        includeWorkspaceUsers: true,
        context: this.getContext(),
        fieldLabel: 'Select user',
        labelWidth: 65,
        width: 275,
        itemId: 'userCombo',
        id: 'userCombo',
        margin: '0 10 0 10',
        listeners: {
          change() {
            this.updateData();
          },
          scope: this
        }
      });
    }

    container
      .add({
        xtype: 'tsarroweddate',
        itemId: 'date_selector',
        fieldLabel: 'Week Starting',
        listeners: {
          scope: this,
          change: function (dp, new_value) {
            if (Ext.isEmpty(new_value)) {
              return;
            }

            var week_start = TSDateUtils.getBeginningOfWeekForLocalDate(new_value, week_starts_on);
            if (week_start !== new_value) {
              dp.setValue(week_start);
            }
            if (new_value.getDay() === week_starts_on) {
              this.updateData();
            }
          }
        }
      })
      .setValue(new Date());
  },

  _addAddButtons: function (container) {
    container.removeAll();

    container.add({
      xtype: 'rallybutton',
      text: 'Add My Tasks',
      toolTipText: '(in current iteration + defaults)',
      padding: 2,
      disabled: false,
      listeners: {
        scope: this,
        click: this._addCurrentTasksAndDefaults
      }
    });

    if (this.getSetting('showAddMyStoriesButton')) {
      container.add({
        xtype: 'rallybutton',
        text: '+ my <span class="icon-story"> </span>',
        toolTipText: 'Add my stories and stories with my tasks',
        disabled: false,
        listeners: {
          scope: this,
          click: this._addCurrentStories
        }
      });
    }

    container.add({
      xtype: 'rallybutton',
      text: '+<span class="icon-task"> </span>',
      disabled: false,
      toolTipText: 'Search and add Tasks',
      listeners: {
        scope: this,
        click: this._findAndAddTask
      }
    });

    container.add({
      xtype: 'rallybutton',
      text: '+<span class="icon-story"> </span>',
      toolTipText: 'Search and add User Stories',
      disabled: false,
      listeners: {
        scope: this,
        click: this._findAndAddStory
      }
    });

    if (this.getSetting('showTaskStateFilter')) {
      container.add({
        xtype: 'rallyfieldvaluecombobox',
        model: 'Task',
        field: 'State',
        fieldLabel: 'State:',
        labelAlign: 'right',
        stateful: true,
        stateId: 'task-state-filter-combo',
        multiSelect: true,
        value: ['Defined', 'In-Progress', 'Completed'],
        listeners: {
          scope: this,
          change: this._filterState
        }
      });
    }
  },

  _filterState: function (stateChange) {
    var timetable = this.down('tstimetable');

    var stateFilter = new Ext.util.Filter({
      filterFn: function (item) {
        return Ext.Array.contains(stateChange.value, item.get('State')) || !item.get('State');
      }
    });

    if (stateChange.value.length > 0) {
      timetable.grid.filter(stateFilter);
    } else {
      timetable.grid.filter(null, true);
    }
  },

  // my workproducts are stories I own and stories that have tasks I own
  _addCurrentStories: function () {
    var timetable = this.down('tstimetable');

    if (!timetable) {
      return;
    }

    this.setLoading('Finding my current stories...');

    var my_filters = Rally.data.wsapi.Filter.or([
      { property: 'Owner.ObjectID', value: this.getContext().getUser().ObjectID },
      { property: 'Tasks.Owner.ObjectID', value: this.getContext().getUser().ObjectID }
    ]);

    var current_filters = Rally.data.wsapi.Filter.and([
      { property: 'Iteration.StartDate', operator: '<=', value: Rally.util.DateTime.toIsoString(this.startDate) },
      { property: 'Iteration.EndDate', operator: '>=', value: Rally.util.DateTime.toIsoString(this.startDate) }
    ]);

    var config = {
      model: 'HierarchicalRequirement',
      context: {
        project: null
      },
      fetch: ['ObjectID', 'Name', 'FormattedID', 'WorkProduct', 'Project'],
      filters: current_filters.and(my_filters)
    };

    TSUtilities.loadWsapiRecords(config).then({
      scope: this,
      success: function (items) {
        var new_item_count = items.length;
        var current_count = timetable.getGrid().getStore().getTotalCount();

        if (current_count + new_item_count > this.getSetting('maxRows')) {
          Ext.Msg.alert('Problem Adding Items', 'Cannot add items to grid. Limit is ' + this.getSetting('maxRows') + ' lines in the time sheet.');
          this.setLoading(false);
        } else {
          Ext.Array.each(items, function (item) {
            timetable.addRowForItem(item);
          });
        }

        this.setLoading(false);
      },
      failure: function (msg) {
        Ext.Msg.alert('Problem with my stories', msg);
      }
    });
  },

  _addCurrentTasksAndDefaults: function () {
    var me = this;

    Deft.Chain.sequence([this._addCurrentTasks, this._addDefaults], this)
      .then({
        failure: function (msg) {
          Ext.Alert.msg('Problem adding current items', msg);
        }
      })
      .always(function () {
        me.setLoading(false);
      });
  },

  _addDefaults: function () {
    var timetable = this.down('tstimetable'),
      me = this;
    if (!timetable) {
      return;
    }

    var defaults = timetable.time_entry_defaults;

    var promises = [];
    this.setLoading('Finding my defaults...');

    Ext.Object.each(defaults, function (oid, type) {
      if (!type) {
        return;
      }

      promises.push(function () {
        var deferred = Ext.create('Deft.Deferred');

        var config = {
          model: type,
          context: {
            project: null
          },
          fetch: ['ObjectID', 'Name', 'FormattedID', 'WorkProduct', 'Project'],
          filters: [{ property: 'ObjectID', value: oid }]
        };

        TSUtilities.loadWsapiRecords(config).then({
          scope: this,
          success: function (items) {
            var new_item_count = items.length;
            var current_count = timetable.getGrid().getStore().getTotalCount();

            if (current_count + new_item_count > me.getSetting('maxRows')) {
              Ext.Msg.alert('Problem Adding Items', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
              me.setLoading(false);
            } else {
              Ext.Array.each(items, function (task) {
                timetable.addRowForItem(task);
              });
            }

            me.setLoading(false);
            deferred.resolve(items);
          },
          failure: function (msg) {
            deferred.reject(msg);
          }
        });

        return deferred.promise;
      });
    });

    return Deft.Chain.sequence(promises);
  },

  _addCurrentTasks: function () {
    var me = this;
    var deferred = Ext.create('Deft.Deferred');

    var timetable = this.down('tstimetable');
    if (!timetable) {
      return;
    }

    this.setLoading('Finding my current tasks...');

    var config = {
      model: 'Task',
      context: {
        project: null
      },
      fetch: ['ObjectID', 'Name', 'FormattedID', 'WorkProduct', 'Project'],
      filters: [
        { property: 'Owner.ObjectID', value: this.getContext().getUser().ObjectID },
        { property: 'Iteration.StartDate', operator: '<=', value: Rally.util.DateTime.toIsoString(this.startDate) },
        { property: 'Iteration.EndDate', operator: '>=', value: Rally.util.DateTime.toIsoString(this.startDate) },
        { property: 'State', operator: '!=', value: 'Completed' }
      ]
    };

    TSUtilities.loadWsapiRecords(config).then({
      scope: this,
      success: function (tasks) {
        var new_item_count = tasks.length;
        var current_count = timetable.getGrid().getStore().getTotalCount();

        if (current_count + new_item_count > me.getSetting('maxRows')) {
          Ext.Msg.alert('Problem Adding Items', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
          this.setLoading(false);
        } else {
          Ext.Array.each(tasks, function (task) {
            timetable.addRowForItem(task);
          });
        }

        this.setLoading(false);
        deferred.resolve(tasks);
      },
      failure: function (msg) {
        deferred.reject(msg);
      }
    });

    return deferred.promise;
  },

  _findAndAddTask: function () {
    var me = this;
    var timetable = this.down('tstimetable');
    var filters = [{ property: 'State', operator: '!=', value: 'Completed' }];
    var fetch_fields = ['WorkProduct', 'Feature', 'Project', 'Name', 'FormattedID', 'ObjectID'];

    if (timetable) {
      Ext.create('Rally.technicalservices.ChooserDialog', {
        artifactTypes: ['task'],
        autoShow: true,
        multiple: true,
        width: 1500,
        title: 'Choose Task(s)',
        context: {
          project: null
        },
        storeConfig: {
          filters: filters
        },
        filterableFields: [
          {
            displayName: 'Formatted ID',
            attributeName: 'FormattedID'
          },
          {
            displayName: 'Name',
            attributeName: 'Name'
          },
          {
            displayName: 'WorkProduct',
            attributeName: 'WorkProduct.Name'
          },
          {
            displayName: 'Project',
            attributeName: 'Project.Name'
          },
          {
            displayName: 'Owner',
            attributeName: 'Owner'
          },
          {
            displayName: 'State',
            attributeName: 'State'
          }
        ],
        columns: [
          {
            text: 'ID',
            dataIndex: 'FormattedID'
          },
          'Name',
          'WorkProduct',
          'Iteration',
          'Release',
          'Project',
          'Owner',
          'State'
        ],
        fetchFields: fetch_fields,
        listeners: {
          artifactchosen: function (dialog, selectedRecords) {
            if (!Ext.isArray(selectedRecords)) {
              selectedRecords = [selectedRecords];
            }

            var new_item_count = selectedRecords.length;
            var current_count = timetable.getGrid().getStore().getTotalCount();

            if (current_count + new_item_count > me.getSetting('maxRows')) {
              Ext.Msg.alert('Problem Adding Tasks', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
            } else {
              Ext.Array.each(selectedRecords, function (selectedRecord) {
                timetable.addRowForItem(selectedRecord);
              });
            }
          },
          scope: this
        }
      });
    }
  },

  _findAndAddStory: function () {
    var me = this;
    var timetable = this.down('tstimetable');
    var filters = Ext.create('Rally.data.QueryFilter', { property: 'ScheduleState', operator: '=', value: 'Requested' });
    filters = filters.or({ property: 'ScheduleState', operator: '=', value: 'Defined' });
    filters = filters.or({ property: 'ScheduleState', operator: '=', value: 'In-Progress' });
    filters = filters.and({ property: 'DirectChildrenCount', operator: '=', value: 0 });
    filters.toString();

    if (timetable) {
      Ext.create('Rally.technicalservices.ChooserDialog', {
        artifactTypes: ['hierarchicalrequirement', 'defect'],
        autoShow: true,
        title: 'Choose Work Product(s)',
        multiple: true,
        width: 1500,
        storeConfig: {
          filters: filters
        },
        filterableFields: [
          {
            displayName: 'Formatted ID',
            attributeName: 'FormattedID'
          },
          {
            displayName: 'Name',
            attributeName: 'Name'
          },
          {
            displayName: 'Project',
            attributeName: 'Project.Name'
          },
          {
            displayName: 'Owner',
            attributeName: 'Owner'
          }
        ],
        columns: [
          {
            text: 'ID',
            dataIndex: 'FormattedID'
          },
          'Name',
          'Release',
          'Iteration',
          'Project',
          'Owner',
          'ScheduleState'
        ],

        fetchFields: ['WorkProduct', 'Feature', 'Project', 'Name', 'FormattedID', 'ObjectID', 'Release', 'ReleaseDate'],

        listeners: {
          artifactchosen: function (dialog, selectedRecords) {
            if (!Ext.isArray(selectedRecords)) {
              selectedRecords = [selectedRecords];
            }

            var new_item_count = selectedRecords.length;
            var current_count = timetable.getGrid().getStore().getTotalCount();

            if (current_count + new_item_count > me.getSetting('maxRows')) {
              Ext.Msg.alert('Problem Adding Stories', 'Cannot add items to grid. Limit is ' + me.getSetting('maxRows') + ' lines in the time sheet.');
            } else {
              Ext.Array.each(selectedRecords, function (selectedRecord) {
                if (selectedRecord.get('Release') && new Date(selectedRecord.get('Release').ReleaseDate) < new Date() && !me.isTimeSheetAdmin) {
                  me.showError(`${selectedRecord.get('FormattedID')} is in a past Release. Time cannot be charged against it`);
                } else {
                  timetable.addRowForItem(selectedRecord);
                }
              });
            }
          },
          scope: this
        }
      });
    }
  },

  updateData: function () {
    var timesheetUser;
    var timetable = this.down('tstimetable');

    if (!Ext.isEmpty(timetable)) {
      timetable.destroy();
    }

    if (this.down('#userCombo') && this.down('#userCombo').getRecord()) {
      timesheetUser = this.down('#userCombo').getRecord().getData();
    }

    this.startDate = this.down('#date_selector').getValue();

    var editable = true;

    this.time_table = this.add({
      xtype: 'tstimetable',
      region: 'center',
      layout: 'fit',
      margin: 15,
      timesheetUser,
      pickableColumns: this.pickableColumns,
      sortedColumn: this.sortedColumn,
      sortDirection: this.sortDirection,
      lowestLevelPIName: this._getLowestLevelPIName(),
      startDate: this.startDate,
      editable: editable,
      maxRows: this.getSetting('maxRows'),
      showEditTimeDetailsMenuItem: this.getSetting('showEditTimeDetailsMenuItem'),
      listeners: {
        scope: this,
        gridReady: function () {
          this._addAddButtons(this.down('#add_button_box'));
        },
        sortchange: function (grid, dataIndex, direction) {
          this.sortedColumn = dataIndex;
          this.sortDirection = direction;
          this.fireEvent('sortchange', this, dataIndex, direction);
        }
      }
    });
  },

  getSettingsFields: function () {
    var check_box_margins = '5 0 5 0';

    var days_of_week = [
      { Name: 'Sunday', Value: 0 },
      { Name: 'Monday', Value: 1 },
      { Name: 'Tuesday', Value: 2 },
      { Name: 'Wednesday', Value: 3 },
      { Name: 'Thursday', Value: 4 },
      { Name: 'Friday', Value: 5 },
      { Name: 'Saturday', Value: 6 }
    ];

    return [
      {
        name: 'weekStartsOn',
        xtype: 'rallycombobox',
        fieldLabel: 'Week Starts On',
        labelWidth: 100,
        labelAlign: 'left',
        minWidth: 200,
        displayField: 'Name',
        valueField: 'Value',
        value: this.getSetting('weekStartsOn'),
        store: Ext.create('Rally.data.custom.Store', {
          data: days_of_week
        }),

        readyEvent: 'ready'
      },
      {
        name: 'showTaskStateFilter',
        xtype: 'rallycheckboxfield',
        boxLabelAlign: 'after',
        fieldLabel: '',
        margin: check_box_margins,
        boxLabel: 'Show the Task State Filter<br/><span style="color:#999999;"><i>User can limit display of tasks to ones in particular states (does not affect other object types).</i></span>'
      },
      {
        name: 'showAddMyStoriesButton',
        xtype: 'rallycheckboxfield',
        boxLabelAlign: 'after',
        fieldLabel: '',
        margin: check_box_margins,
        boxLabel:
          'Show the Add My Stories Button<br/><span style="color:#999999;"><i>User can add stories in a current sprint that they own or that have tasks they own (does not look for default items).</i></span>'
      },
      {
        name: 'showEditTimeDetailsMenuItem',
        xtype: 'rallycheckboxfield',
        boxLabelAlign: 'after',
        fieldLabel: '',
        margin: check_box_margins,
        boxLabel: 'Include Time Details Option in Menu (Experimental)<br/><span style="color:#999999;"><i>User can enter time ranges during the day to calculate time entry. </i></span>'
      },
      {
        xtype: 'rallynumberfield',
        name: 'maxRows',
        labelWidth: 100,
        labelAlign: 'left',
        width: 200,
        maxValue: 1000,
        minValue: 10,
        fieldLabel: 'Maximum number of rows',
        value: this.getSetting('maxRows') || 100
      }
    ];
  },

  getState: function () {
    return {
      pickableColumns: this.pickableColumns,
      sortedColumn: this.sortedColumn,
      sortDirection: this.sortDirection
    };
  },

  isExternal: function () {
    return typeof this.getAppId() == 'undefined';
  },

  onSettingsUpdate: function () {
    this.launch();
  },

  showError(msg, defaultMessage) {
    Rally.ui.notify.Notifier.showError({ message: this.parseError(msg, defaultMessage) });
  },

  parseError(e, defaultMessage) {
    defaultMessage = defaultMessage || 'An unknown error has occurred';

    if (typeof e === 'string' && e.length) {
      return e;
    }
    if (e.message && e.message.length) {
      return e.message;
    }
    if (e.exception && e.error && e.error.errors && e.error.errors.length) {
      if (e.error.errors[0].length) {
        return e.error.errors[0];
      }
      if (e.error && e.error.response && e.error.response.status) {
        return `${defaultMessage} (Status ${e.error.response.status})`;
      }
    }
    if (e.exceptions && e.exceptions.length && e.exceptions[0].error) {
      return e.exceptions[0].error.statusText;
    }
    if (e.exception && e.error && typeof e.error.statusText === 'string' && !e.error.statusText.length && e.error.status && e.error.status === 524) {
      return 'The server request has timed out';
    }
    return defaultMessage;
  }
});
