'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableDefinition = await queryInterface.describeTable('file_operations');
    if (!tableDefinition.documentId) {
      await queryInterface.addColumn('file_operations', 'documentId', {
        type: Sequelize.UUID,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('file_operations', 'documentId');
  }
};
