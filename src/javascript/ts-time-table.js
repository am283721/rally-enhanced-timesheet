Ext.override(Rally.ui.grid.plugin.Validation,{
    _onBeforeEdit: function(editor, object, eOpts) {
        // clear this because it won't let us do the getEditor on cells
    }
});

Ext.define('CA.techservices.TimeTable', {
    extend: 'Ext.Container',
    alias:  'widget.tstimetable',
    
    logger: new Rally.technicalservices.Logger(),
    
    rows: [],
    cls: 'tstimetable',
    
    time_entry_item_fetch: ['WeekStartDate','WorkProductDisplayString','WorkProduct','Task',
        'TaskDisplayString','Feature','Project', 'ObjectID', 'Name', 'Release', 'FormattedID'],
        
    config: {
        startDate: null,
        editable: true,
        timesheetUser: null
    },
    
    constructor: function (config) {
        this.mergeConfig(config);
        
        if (Ext.isEmpty(config.startDate) || !Ext.isDate(config.startDate)) {
            throw "CA.techservices.TimeTable requires startDate parameter (JavaScript Date)";
        }
        
        this.callParent([this.config]);
    },
    
    initComponent: function() {
        var me = this;
        
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
        
                
        if ( Ext.isEmpty(this.timesheetUser) ) {
            this.timesheetUser = Rally.getApp().getContext().getUser();
        }
        // shift start date
        this.startDate = TSDateUtils.pretendIMeantUTC(this.startDate);
        
        this._updateData();
    },
    
    _updateData: function() {
        this.setLoading('Loading time...');
        var me = this;
        
        Deft.Chain.sequence([
            this._loadTimeEntryItems,
            this._loadTimeEntryValues
        ],this).then({
            scope: this,
            success: function(results) {
                var time_entry_items  = results[0];
                var time_entry_values = results[1];
                
                this.rows = this._createRows(time_entry_items, time_entry_values);
                this._makeGrid(this.rows);
                this.setLoading(false);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem Loading', msg);
            }
        });
    },
    
    _makeGrid: function(rows) {
        this.removeAll();
        var me = this,
            table_store = Ext.create('Rally.data.custom.Store',{
                groupField: '__SecretKey',
                data: rows,
                pageSize: 100
            });
            
        this.grid = this.add({ 
            xtype:'rallygrid', 
            store: table_store,
            columnCfgs: this._getColumns(),
            showPagingToolbar : false,
            showRowActionsColumn : false,
            sortableColumns: false,
            disableSelection: true,
            enableColumnMove: false,
            enableColumnResize : false,
            features: [{
                ftype: 'groupingsummary',
                startCollapsed: false,
                hideGroupedHeader: true,
                groupHeaderTpl: ' ',
                enableGroupingMenu: false
            }]
        });
        
        this.fireEvent('gridReady', this, this.grid);
    },
    
    _getColumns: function() {
        var me = this,
            columns = [];
        
        var columns = Ext.Array.push(columns,[
            {
                dataIndex: 'Project',
                text: 'Project',
                flex: 1,
                editor: null,
                renderer: function(value, meta, record) {
                    if ( Ext.isEmpty(value) ) {
                        return '--';
                    }
                    return value._refObjectName;
                }
            },
            {
                dataIndex: 'WorkProduct',
                text: 'Work Item',
                flex: 1,
                editor: null,
                renderer: function(value, meta, record) {
                    if ( Ext.isEmpty(value) ) {
                        return '--';
                    }
                    return Ext.String.format("<a target='_blank' href='{0}'>{1}</a>: {2}",
                        Rally.nav.Manager.getDetailUrl(value),
                        record.get('WorkProduct').FormattedID,
                        record.get('WorkProduct').Name
                    );;
                }
            },
            {
                dataIndex: 'Task',
                text: 'Task',
                flex: 1,
                editor: null,
                renderer: function(value, meta, record) {
                    if ( Ext.isEmpty(value) ) {
                        return '--';
                    }
                    return Ext.String.format("<a target='_blank' href='{0}'>{1}</a>: {2}",
                        Rally.nav.Manager.getDetailUrl(value),
                        record.get('Task').FormattedID,
                        record.get('Task').Name
                    );;
                }
            }
        ]);
       
        Ext.Array.each( CA.techservices.timesheet.TimeRowUtils.daysInOrder, function(day) {
            columns.push(this._getColumnForDay(day));
        },this);
        
        var total_renderer = function(value, meta, record) {
            meta.tdCls = "ts-total-cell";
            return value;
        }; 
        
        columns.push({
            dataIndex:'Total',
            text:'Total', 
            width: 50, 
            resizable: false, 
            align: 'center',
            editor: null,
            summaryType: 'sum',
//            summaryRenderer: function(value,meta,record) {
//                if ( value < 40 ) {
//                    meta.style = 'background: #fec6cd;';
//                }
//                return value;
//            },
            renderer: total_renderer
        });
            
        return columns;
    },
    
    _getColumnForDay: function(day) {
        var disabled = false;
        
        var editor_config = function(record,df) {
            var minValue = 0;
            return Ext.create('Ext.grid.CellEditor', {
                field: Ext.create('Rally.ui.NumberField', {
                    xtype:'rallynumberfield',
                    minValue: minValue,
                    maxValue: 24,
                    disabled: disabled,
                    selectOnFocus: true,
                    listeners: {
                        change: function(field, new_value, old_value) {1
                            if ( Ext.isEmpty(new_value) ) {
                                field.setValue(0);
                            }
                        }
                    }
                })
            });
        };

        var config = {
            dataIndex:day,
            text: CA.techservices.timesheet.TimeRowUtils.dayShortNames[day],
            width: 50, 
            resizable: false,
            align: 'center',
            getEditor: editor_config, 
            summaryType: 'sum'
        };
        
        if ( day == "Saturday" || day == "Sunday" ) {
            config.renderer = function(value, meta, record) {
                meta.tdCls = "ts-weekend-cell";
                return value;
            };
        }
        
        return config;
    },
            
    _createRows: function(time_entry_items, time_entry_values) {
        var rows = [];
        
        Ext.Array.map(time_entry_items, function(time_entry_item){
            var oid = time_entry_item.get('ObjectID');
            var values_for_time_entry_item =  Ext.Array.filter(time_entry_values, function(time_entry_value){
                return time_entry_value.get('TimeEntryItem').ObjectID == oid;
            });
            
            rows.push(Ext.create('CA.techservices.timesheet.TimeRow',{
                TimeEntryItemRecords: [time_entry_item],
                TimeEntryValueRecords: values_for_time_entry_item
            }));
        });
        
        return rows;
    },
    
    
    _loadTimeEntryItems: function() {
        this.setLoading('Loading time entry items...');
        
        var config = {
            model: 'TimeEntryItem',
            context: {
                project: null
            },
            fetch: this.time_entry_item_fetch,
            filters: [
                {property:'WeekStartDate',value:this.startDate},
                {property:'User.ObjectID',value:this.timesheetUser.ObjectID}
            ]
        };
        
        return TSUtilities.loadWsapiRecords(config);
    },
    
    _loadTimeEntryValues: function() {
        this.setLoading('Loading time entry values...');

        var config = {
            model: 'TimeEntryValue',
            context: {
                project: null
            },
            fetch: ['DateVal','Hours','TimeEntryItem','ObjectID'],
            filters: [
                {property:'TimeEntryItem.WeekStartDate',value:this.startDate},
                {property:'TimeEntryItem.User.ObjectID',value:this.timesheetUser.ObjectID}
            ]
        };
        
        return TSUtilities.loadWsapiRecords(config);        
    }
});